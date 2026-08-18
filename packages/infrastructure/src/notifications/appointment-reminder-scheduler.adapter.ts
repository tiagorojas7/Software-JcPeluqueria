import type { AppointmentReminderScheduler } from '@jc-barberia/domain';

import type { JobSender, TransactionalDb } from '../booking/pg-boss-hold-expire-scheduler';

/**
 * The queue name shared by the producer (this adapter, called from
 * `ScheduleAppointmentReminder`) and the consumer (`apps/worker`'s
 * `appointment.reminder` handler) — same "named constant, never a duplicated
 * string literal" reasoning as `HOLD_EXPIRE_QUEUE`.
 */
export const APPOINTMENT_REMINDER_QUEUE = 'appointment.reminder';

/**
 * Payload the `appointment.reminder` handler receives. Deliberately just the
 * id — same reasoning as `HoldExpireJob`: the handler re-reads the
 * appointment (and its client's current email) at fire time, 2 hours later,
 * rather than trusting a snapshot taken at schedule time that could be stale
 * (email added after booking, seña refunded since, etc.).
 */
export interface AppointmentReminderJob {
  readonly appointmentId: string;
}

/**
 * Production `AppointmentReminderScheduler`. Turns
 * `ScheduleAppointmentReminder`'s "remind no earlier than `startAfter`" into
 * a deferred pg-boss job, structurally identical to `PgBossHoldExpireScheduler`
 * (reused `JobSender`/`TransactionalDb` shapes — both adapters send one
 * deferred job through the same pg-boss instance, so they share the exact
 * transactional-enqueue contract).
 *
 * `startAfter` is forwarded untouched — it is `appointmentStart -
 * REMINDER_LEAD_MINUTES`, computed by the caller's own `Clock`, never a fresh
 * wall-clock read here.
 */
export class PgBossAppointmentReminderScheduler implements AppointmentReminderScheduler {
  constructor(
    private readonly boss: JobSender,
    private readonly currentTransaction?: () => TransactionalDb | undefined,
  ) {}

  async scheduleReminder(input: { readonly appointmentId: string; readonly startAfter: Date }): Promise<void> {
    const db = this.currentTransaction?.();
    const payload: AppointmentReminderJob = { appointmentId: input.appointmentId };

    await this.boss.send(
      APPOINTMENT_REMINDER_QUEUE,
      payload,
      { startAfter: input.startAfter, ...(db ? { db } : {}) },
    );
  }
}
