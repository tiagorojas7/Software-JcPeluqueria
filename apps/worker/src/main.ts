import { PgBoss } from 'pg-boss';
import { DailySweepUseCase, ProcessPaymentUseCase } from '@jc-barberia/application';
import {
  DrizzleAppointmentSweepRepository,
  DrizzleDepositRepository,
  HOLD_EXPIRE_QUEUE,
  MercadoPagoPaymentAdapter,
  PAYMENT_PROCESS_QUEUE,
  ShopClock,
  db,
} from '@jc-barberia/infrastructure';

/**
 * The single background process for the turnero (design.md "Procesos de
 * fondo"). pg-boss shares the app's own PostgreSQL — no extra Redis — so a
 * `hold.expire` job can be enqueued in the same transaction that creates the
 * hold (no orphan jobs on rollback). Phase 6 registers the handlers here; the
 * tasks.md wiring map names the four, plus `payment.process` (task 9.11/9.12,
 * `PAYMENT_JOB_QUEUE`'s consuming half — the webhook has enqueued into this
 * exact queue name since 5.10; nothing ever consumed it until now):
 *
 *  - `daily.sweep`   (6.7): `59 2 * * *` UTC — wired HERE now; its adapters
 *    (ShopClock + DrizzleAppointmentSweepRepository) already exist, so this
 *    slice boots a production-grade sweep.
 *  - `payment.process` (9.11/9.12): wired HERE now — `ProcessPaymentUseCase`
 *    (5.9/5.10) and its two adapters (`MercadoPagoPaymentAdapter`,
 *    `DrizzleDepositRepository`) already existed and were already tested;
 *    the only missing piece was this registration. Same reused use case the
 *    application layer already proved in `process-payment.spec.ts` — no
 *    second payment path, this is just the consumer for the queue
 *    `PgBossPaymentJobQueue` (the producer, `apps/api`) already sends to.
 *  - `hold.expire` (6.5): deferred — needs `DrizzleHoldExpireViewRepository`
 *    (the row + client-email join) + `RefundUseCase` + a `NotificationPort`
 *    adapter. Scaffolding below marks the contract; Phase 7/wiring step owns
 *    the real registration. Until then the slot liberation stays LAZY (the
 *    availability read path already frees an expired non-`payment_pending`
 *    hold), so the worker not having this handler is correct, not a hole.
 *  - `appointment.reminder` (6.11): deferred — needs the Drizzle
 *    `notification_outbox` writer + the appointment view (clientId, email,
 *    deposit) + `ScheduleAppointmentReminder` enqueued from the confirm path.
 *    Scaffolding below; Phase 7 wires the real adapter.
 *  - `notification_outbox` consumer (6.13): deferred — needs the Drizzle outbox
 *    repository (`pickPending` / `markDelivered` / `markFailed`, backoff-aware)
 *    + the Gmail `NotificationPort` adapter. Scaffolding below; Phase 7 owns
 *    the real delivery (task 7.8 connects the outbox writers to the adapter).
 */
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://jc_barberia:jc_barberia@localhost:5432/jc_barberia_test';

async function main(): Promise<void> {
  const boss = new PgBoss(connectionString);
  await boss.start();

  // 6.7 / 6.9 — the day-end sweep, wired for real. ShopClock resolves the
  // swept day from now() (calendarDateOf → businessDayBounds); the Drizzle
  // repo transitions the in-bounds reservados to sin_registrado con y sin seña
  // alike. The cron is `59 2 * * *` UTC = 23:59 shop-local (UTC-3).
  //
  // arranque finding: pg-boss v12 requires a queue to be explicitly
  // registered (`createQueue`) before `schedule()`/`work()` can target it —
  // `schedule.name` carries an FK to `pgboss.queue.name` in this version.
  // Older pg-boss auto-created queues on first use; this codebase never ran
  // against a real database outside tests until this slice, so the gap was
  // invisible until `pnpm --filter @jc-barberia/worker start` was actually
  // tried. `createQueue` is `ON CONFLICT DO NOTHING` internally, so calling
  // it on every boot is safe.
  const sweep = new DailySweepUseCase(new ShopClock(), new DrizzleAppointmentSweepRepository(db));
  await boss.createQueue('daily.sweep');
  await boss.schedule('daily.sweep', '59 2 * * *');
  await boss.work('daily.sweep', async () => {
    const swept = await sweep.execute();
    console.log(`[worker] daily.sweep transitioned ${swept} reservados to sin_registrado`);
  });

  // 9.11/9.12 — the webhook's consuming half. `getPayment()` is the only
  // source of truth (design.md: "el redirect del navegador no es fuente de
  // verdad"), never the enqueued payload — `ProcessPaymentUseCase` re-reads
  // the payment id against MercadoPago itself before deciding anything.
  const processPayment = new ProcessPaymentUseCase(
    new MercadoPagoPaymentAdapter(process.env.MERCADOPAGO_ACCESS_TOKEN ?? ''),
    new DrizzleDepositRepository(db),
  );
  // pg-boss v12's `work()` handler always receives a batch (`Job<T>[]`), even
  // for a single enqueue — never a lone job object. Same `createQueue`
  // requirement as `daily.sweep` above: `PgBossPaymentJobQueue` (the
  // producer, `apps/api`) enqueues by name only, it never registers the
  // queue itself.
  await boss.createQueue(PAYMENT_PROCESS_QUEUE);
  await boss.work<{ paymentId: string }>(PAYMENT_PROCESS_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const result = await processPayment.execute(job.data.paymentId);
      console.log(`[worker] payment.process ${job.data.paymentId} -> ${result.outcome}`);
    }
  });

  // arranque finding: `CreateHold` (both `HoldController` and
  // `PhoneAppointmentController`, i.e. the FIRST step of every booking)
  // unconditionally calls `PgBossHoldExpireScheduler.scheduleExpire`, which
  // sends into this exact queue name. Without registering it, `send()`
  // throws "Queue hold.expire does not exist" the moment a demo operator
  // creates the very first hold — discovered by actually running the app,
  // not by reading the code. No `.work()` handler is registered here YET
  // (see the TODO below): the jobs land and sit unconsumed, which is exactly
  // the "slot liberation stays LAZY" behavior the comment below already
  // documents as correct for this phase — only the registration was missing.
  await boss.createQueue(HOLD_EXPIRE_QUEUE);

  // TODO(phase-7): wire `hold.expire`'s CONSUMER — once DrizzleHoldExpireViewRepository
  //   AND a Drizzle-backed NotificationOutboxRepository land (still missing
  //   from this codebase as of Phase 12 — see apply-progress for the
  //   honest accounting of this gap):
  //   const expire = new ExpireHold(new DrizzleHoldExpireViewRepository(db),
  //     new RefundUseCase(...), notifications /* GmailNotificationAdapter */,
  //     new DrizzleAppointmentRepository(db) /* task 12.11 — cancels the
  //     origin turno once its offer hold lapses unconfirmed */);
  //   await boss.work('hold.expire', async (job: { data: { holdId: string } }) => {
  //     await expire.execute(job.data.holdId);
  //   });
  // The 23:59 sweep + the reminder + the outbox consumer below are independent;
  // `hold.expire` not being registered only means the human-absolute refund +
  // cancel-on-lapse stays the lazy path until Phase 7 — safe by design (6.5).
  // design.md's own testing table scopes barber-absence-reassignment's
  // application layer to in-memory adapters (task 12.10/12.11's ExpireHold
  // extension is proven that way, in hold-expire.spec.ts); this TODO's real
  // wiring remains open, exactly as it already was before this phase.

  // TODO(phase-7): wire `appointment.reminder` — once the Drizzle outbox writer
  //   + the appointment reminder view land:
  //   const reminder = new AppointmentReminder(new DrizzleNotificationOutboxRepository(db));
  //   await boss.work('appointment.reminder', async (job) => {
  //     await reminder.execute(job.data as AppointmentReminderInput);
  //   });
  // The schedule itself is enqueued per-turno by ScheduleAppointmentReminder
  // from the confirm path (API side), NOT here — this entry only owns the
  // handler that fires 2h before the appointment.

  // TODO(phase-7): wire the `notification_outbox` consumer — once
  //   DrizzleNotificationOutboxRepository (backoff-aware pickPending +
  //   markFailed) + GmailNotificationAdapter land:
  //   const outboxConsumer = new NotificationOutboxConsumer(
  //     new GmailNotificationAdapter(...), new DrizzleNotificationOutboxRepository(db));
  //   await boss.schedule('notification_outbox.consume', '* * * * *'); // short tick
  //   await boss.work('notification_outbox.consume', async () => {
  //     await outboxConsumer.execute();
  //   });

  console.log(
    '[worker] pg-boss started — daily.sweep, payment.process registered (consumed); ' +
      'hold.expire registered (queue only, no consumer yet — see TODO(phase-7))',
  );
}

main().catch((error: unknown) => {
  console.error('[worker] failed to start', error);
  process.exit(1);
});
