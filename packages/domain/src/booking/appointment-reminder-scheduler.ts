/**
 * How far ahead of the appointment's start the reminder fires
 * (notification-port spec, "Eventos mínimos que deben notificarse":
 * "despachado 2 horas antes de la hora agendada"). This — not a fixed cron —
 * is what makes the reminder "schedule dinámico por turno": each appointment
 * gets its OWN job enqueued at `appointmentStart - REMINDER_LEAD_MINUTES`, so
 * a reminder never fires for an appointment far in the future and never
 * collects them into a shared cron pass that would miss the 2h precision.
 *
 * Phase 7's template also depends on this value: it leaves a ~1h window between
 * the reminder and the cancellation limit (`appointmentStart - 1h`,
 * client-booking spec), so the con-seña message can name that exact deadline.
 */
export const REMINDER_LEAD_MINUTES = 120;

/**
 * Schedules the `appointment.reminder` job for one appointment, to fire no
 * earlier than `startAfter` — the appointment's own `start - REMINDER_LEAD_MINUTES`,
 * computed by the same `Clock` that booked the appointment, never a fresh
 * wall-clock read inside the scheduler. The pg-boss adapter's transactional
 * enqueue guarantees the job lands in the same transaction that created the
 * appointment, so a rollback discards both — no orphan reminder for a turn
 * that never committed (same shape as the `hold.expire` scheduler in `CreateHold`).
 */
export interface AppointmentReminderScheduler {
  scheduleReminder(input: {
    readonly appointmentId: string;
    readonly startAfter: Date;
  }): Promise<void>;
}
