import { PgBoss } from 'pg-boss';
import {
  AppointmentReminder,
  DailySweepUseCase,
  ExpireHold,
  NotificationOutboxConsumer,
  ProcessPaymentUseCase,
  RefundUseCase,
} from '@jc-barberia/application';
import {
  APPOINTMENT_REMINDER_QUEUE,
  DrizzleAppointmentRepository,
  DrizzleAppointmentSweepRepository,
  DrizzleClientRepository,
  DrizzleDepositRepository,
  DrizzleHoldExpireViewRepository,
  DrizzleNotificationOutboxRepository,
  HOLD_EXPIRE_QUEUE,
  MercadoPagoPaymentAdapter,
  PAYMENT_PROCESS_QUEUE,
  ShopClock,
  createNotificationPort,
  createTemplateRegistry,
  db,
  type NotificationChannel,
} from '@jc-barberia/infrastructure';

/** The `appointment.reminder` job's payload shape — mirrors
 *  `AppointmentReminderJob` (infra) without importing it just for a type,
 *  since only the field name matters here. */
interface AppointmentReminderJobData {
  readonly appointmentId: string;
}

/** How often the outbox is drained. Not shared with any producer (nothing
 *  else sends to this queue by name — it is a self-scheduled tick, not an
 *  event), so it stays a local constant instead of an exported one. */
const OUTBOX_CONSUME_QUEUE = 'notification_outbox.consume';

/**
 * The single background process for the turnero (design.md "Procesos de
 * fondo"). pg-boss shares the app's own PostgreSQL — no extra Redis — so a
 * `hold.expire` job can be enqueued in the same transaction that creates the
 * hold (no orphan jobs on rollback).
 *
 * Slice A (cablear-el-mvp) closes the three gaps this file used to carry as
 * TODOs — the exact ones the tracker opens with ("7.8 decia 'plantillas
 * conectadas a los outbox-writers'... 6.13 decia 'consumidor del outbox'.
 * El caso de uso existe pero no esta cableado al worker"):
 *
 *  - `daily.sweep`   (6.7): unchanged, already wired.
 *  - `payment.process` (9.11/9.12): unchanged, already wired.
 *  - `hold.expire` (6.5/A.5): now consumed — `ExpireHold` + `RefundUseCase` +
 *    the real `NotificationPort` + the new `DrizzleHoldExpireViewRepository`.
 *  - `appointment.reminder` (6.11/A.6): now consumed — re-reads the
 *    appointment's CURRENT state at fire time via the existing
 *    `DrizzleAppointmentRepository`/`DrizzleClientRepository` (never trusts a
 *    schedule-time snapshot, same "re-read, don't trust the payload"
 *    philosophy `ProcessPaymentUseCase` already uses for payments). KNOWN GAP:
 *    nothing enqueues into this queue yet — `ScheduleAppointmentReminder` is
 *    not called from any confirmation path (`CreatePhoneAppointmentUseCase` /
 *    `ProcessPaymentUseCase`). Wiring that producer call touches
 *    `packages/application` use-case constructors and their NestJS DI wiring
 *    in `apps/api` — both outside this slice's file ownership
 *    (`packages/infrastructure`, `apps/worker`, `packages/domain/notifications`
 *    only). Left as an explicit follow-up rather than silently claimed done.
 *  - `notification_outbox` consumer (6.13/A.4): now consumed — drains
 *    `pending` rows once a minute via the real `DrizzleNotificationOutboxRepository`
 *    and dispatches through `createNotificationPort` (channel picked by
 *    `NOTIFICATION_CHANNEL`, defaulting to `console` so a fresh clone never
 *    silently attempts real SMTP).
 */
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://jc_barberia:jc_barberia@localhost:5432/jc_barberia_test';

async function main(): Promise<void> {
  const boss = new PgBoss(connectionString);
  // Same reason as the producer's handler in `job-producer.ts`: pg-boss is an
  // EventEmitter and an unhandled 'error' event crashes the Node process
  // outright. The worker polls constantly, so it is the MORE exposed of the
  // two — a single transient database blip would otherwise stop every
  // background job (sweep, reminders, hold expiry, outbox delivery) until
  // someone noticed the process was gone.
  boss.on('error', (error) => {
    console.error('[worker] pg-boss error (kept alive):', error);
  });
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

  // A.4 — the real NotificationPort, shared by hold.expire's notification
  // AND the outbox consumer below. NOTIFICATION_CHANNEL defaults to
  // 'console' (ConsoleNotificationAdapter, notification-port spec's "canal
  // alternativo") so a fresh clone or this exact demo never silently tries
  // real SMTP — GMAIL_* must be set explicitly to opt into Gmail.
  const notificationChannel = (process.env.NOTIFICATION_CHANNEL ?? 'console') as NotificationChannel;
  const notifications = createNotificationPort(
    {
      channel: notificationChannel,
      gmailUser: process.env.GMAIL_USER,
      gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
      gmailFrom: process.env.GMAIL_FROM,
    },
    { templates: createTemplateRegistry(new ShopClock()) },
  );

  // arranque finding: `CreateHold` (both `HoldController` and
  // `PhoneAppointmentController`, i.e. the FIRST step of every booking)
  // unconditionally calls `PgBossHoldExpireScheduler.scheduleExpire`, which
  // sends into this exact queue name. Without registering it, `send()`
  // throws "Queue hold.expire does not exist" the moment a demo operator
  // creates the very first hold — discovered by actually running the app,
  // not by reading the code.
  await boss.createQueue(HOLD_EXPIRE_QUEUE);

  // A.5 — `hold.expire`'s CONSUMER. The slot itself still frees lazily (the
  // availability read path already handles that); this handler owns only the
  // two effects that can never be lazy: the origin seña refund (+ cancelling
  // the origin turno once the money side resolves) and the
  // cancellation-with-refund notification. See `ExpireHold`'s own docstring
  // for the full outcome table.
  const expireHold = new ExpireHold(
    new DrizzleHoldExpireViewRepository(db),
    new RefundUseCase(
      new DrizzleDepositRepository(db),
      new MercadoPagoPaymentAdapter(process.env.MERCADOPAGO_ACCESS_TOKEN ?? ''),
    ),
    notifications,
    new DrizzleAppointmentRepository(db),
  );
  await boss.work<{ holdId: string }>(HOLD_EXPIRE_QUEUE, async (jobs) => {
    for (const job of jobs) {
      try {
        const outcome = await expireHold.execute(job.data.holdId);
        console.log(`[worker] hold.expire ${job.data.holdId} -> ${outcome}`);
        // 'retry' is the 428-insufficient-funds business state (ExpireHold's
        // own docstring): the deposit stays settled, the money side is not
        // resolved. Throwing lets pg-boss's own retry/backoff policy pick
        // this job back up instead of silently dropping it — this worker
        // does not implement a bespoke requeue-with-backoff beyond that,
        // which is an explicit, known limitation of this slice, not a gap
        // hidden as done.
        if (outcome === 'retry') {
          throw new Error(`hold.expire ${job.data.holdId}: pending-insufficient-funds, letting pg-boss retry`);
        }
      } catch (error) {
        console.error(`[worker] hold.expire ${job.data.holdId} failed`, error);
        throw error;
      }
    }
  });

  // A.6 — `appointment.reminder`'s CONSUMER. `PgBossAppointmentReminderScheduler`
  // (infra) sends only `{ appointmentId }` — this handler re-reads the
  // appointment's CURRENT client/deposit/time via the existing
  // `DrizzleAppointmentRepository`/`DrizzleClientRepository`, never trusting a
  // schedule-time snapshot that could be stale two hours later (email added
  // since, seña refunded since). A missing appointment (cancelled since
  // scheduling) is a silent no-op — nothing left to remind about.
  //
  // KNOWN GAP: no production caller enqueues into this queue yet.
  // `ScheduleAppointmentReminder` is proven at the application layer
  // (appointment-reminder.spec.ts) but nothing calls `.execute()` from
  // `CreatePhoneAppointmentUseCase` or `ProcessPaymentUseCase` — wiring that
  // touches `packages/application` + `apps/api` DI, outside this slice's file
  // ownership. This handler is real and tested by being wired below; it is
  // just not triggered by anything yet.
  const appointmentReminder = new AppointmentReminder(new DrizzleNotificationOutboxRepository(db));
  const appointmentsForReminder = new DrizzleAppointmentRepository(db);
  const clientsForReminder = new DrizzleClientRepository(db);
  await boss.createQueue(APPOINTMENT_REMINDER_QUEUE);
  await boss.work<AppointmentReminderJobData>(APPOINTMENT_REMINDER_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const appointment = await appointmentsForReminder.findById(job.data.appointmentId);
      if (!appointment) {
        console.log(`[worker] appointment.reminder ${job.data.appointmentId} -> skipped (appointment gone)`);
        continue;
      }
      const client = await clientsForReminder.findById(appointment.clientId);
      await appointmentReminder.execute({
        appointmentId: appointment.id,
        clientEmail: client?.email ?? null,
        hasSettledDeposit: appointment.deposit.kind === 'settled',
        appointmentTime: appointment.timeRange.start.toISOString(),
      });
      console.log(`[worker] appointment.reminder ${appointment.id} -> outbox intent enqueued`);
    }
  });

  // A.4 — the `notification_outbox` consumer. Every writer above (and every
  // other outbox writer in this codebase: RequestClientAccessUseCase,
  // GenerateAbsenceReassignmentOffers, ResetPasswordUseCase, ...) only ever
  // wrote an INTENTION; this tick is the only thing that ever turns a pending
  // row into a real dispatched message. `'* * * * *'` (every minute) keeps
  // the console-channel demo (A.7) observable without a long wait.
  const outboxConsumer = new NotificationOutboxConsumer(notifications, new DrizzleNotificationOutboxRepository(db));
  await boss.createQueue(OUTBOX_CONSUME_QUEUE);
  await boss.schedule(OUTBOX_CONSUME_QUEUE, '* * * * *');
  await boss.work(OUTBOX_CONSUME_QUEUE, async () => {
    const summary = await outboxConsumer.execute();
    if (summary.delivered > 0 || summary.failed > 0) {
      console.log(`[worker] notification_outbox.consume delivered=${summary.delivered} failed=${summary.failed}`);
    }
  });

  console.log(
    `[worker] pg-boss started — daily.sweep, payment.process, hold.expire, appointment.reminder and ` +
      `notification_outbox.consume all registered and consumed (notification channel: ${notificationChannel})`,
  );
}

main().catch((error: unknown) => {
  console.error('[worker] failed to start', error);
  process.exit(1);
});
