import { PgBoss } from 'pg-boss';
import { DailySweepUseCase } from '@jc-barberia/application';
import { DrizzleAppointmentSweepRepository, ShopClock, db } from '@jc-barberia/infrastructure';

/**
 * The single background process for the turnero (design.md "Procesos de
 * fondo"). pg-boss shares the app's own PostgreSQL — no extra Redis — so a
 * `hold.expire` job can be enqueued in the same transaction that creates the
 * hold (no orphan jobs on rollback). Phase 6 registers the handlers here; the
 * tasks.md wiring map names the four:
 *
 *  - `daily.sweep`   (6.7): `59 2 * * *` UTC — wired HERE now; its adapters
 *    (ShopClock + DrizzleAppointmentSweepRepository) already exist, so this
 *    slice boots a production-grade sweep.
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
  const sweep = new DailySweepUseCase(new ShopClock(), new DrizzleAppointmentSweepRepository(db));
  await boss.schedule('daily.sweep', '59 2 * * *');
  await boss.work('daily.sweep', async () => {
    const swept = await sweep.execute();
    console.log(`[worker] daily.sweep transitioned ${swept} reservados to sin_registrado`);
  });

  // TODO(phase-7): wire `hold.expire` — once DrizzleHoldExpireViewRepository
  //   lands:
  //   const expire = new ExpireHold(new DrizzleHoldExpireViewRepository(db),
  //     new RefundUseCase(...), notifications /* GmailNotificationAdapter */);
  //   await boss.work('hold.expire', async (job: { data: { holdId: string } }) => {
  //     await expire.execute(job.data.holdId);
  //   });
  // The 23:59 sweep + the reminder + the outbox consumer below are independent;
  // `hold.expire` not being registered only means the human-absolute refund +
  // cancel-on-lapse stays the lazy path until Phase 7 — safe by design (6.5).

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

  console.log('[worker] pg-boss started — daily.sweep registered');
}

main().catch((error: unknown) => {
  console.error('[worker] failed to start', error);
  process.exit(1);
});
