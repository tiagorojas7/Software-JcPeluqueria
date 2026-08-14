/**
 * Schedules the `hold.expire` job for a hold. design.md "Encolado
 * transaccional": the job is enqueued in the SAME transaction that creates
 * the hold, so a rollback discards both — no orphan jobs whose refund +
 * notification would fire for a hold that never committed. The shared
 * transaction is the pg-boss adapter's concern (its `db` connection option);
 * this port only exposes the unit contract the application layer depends on:
 * "enqueue the expiry of this hold to fire no earlier than `startAfter`",
 * where `startAfter` is the expiry the same `Clock` that built the hold
 * computed — never a wall-clock read inside the scheduler.
 */
export interface HoldExpireScheduler {
  scheduleExpire(input: { readonly holdId: string; readonly startAfter: Date }): Promise<void>;
}