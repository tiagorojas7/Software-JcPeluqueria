import type { NotificationOutboxRepository } from '@jc-barberia/domain';

/**
 * The snapshot the `appointment.reminder` handler needs to decide whether it
 * "corresponde" dispatch a reminder (notification-port spec, "Eventos mínimos
 * que deben notificarse"). The handler runs at `appointmentStart -
 * REMINDER_LEAD_MINUTES`, a job whose timing is the scheduler's concern — NOT
 * THIS use case's — so the input carries no wall-clock; it only carries the
 * facts the dispatch decision + the outbox event need.
 *
 * There is NO `channel` field, by design: the spec sends the reminder for
 * both web and phone turns alike, gated ONLY on the email; branching on
 * channel here would be a bug. The seña is reduced to a boolean
 * `hasSettledDeposit` because that is the entire template selector — Phase 7
 * renders the "última oportunidad" deadline fork off this same boolean.
 */
export interface AppointmentReminderInput {
  readonly appointmentId: string;
  /** Null only when the client has no email registrado — then NO reminder.
   *  notification-port spec: "un cliente sin email no recibe ningún
   *  recordatorio", admin-operations spec: phone walk-in sin email alike. */
  readonly clientEmail: string | null;
  /** `deposit.kind === 'settled'` at reminder time; selects the template. */
  readonly hasSettledDeposit: boolean;
  /** ISO of the appointment's scheduled start — Phase 7 derives the
   *  cancellation deadline (`start - 1h`) and the local time from it. */
  readonly appointmentTime: string;
}

/**
 * The `appointment.reminder` pg-boss handler, as an application-layer use
 * case — the same layered shape `ExpireHold` takes (6.4/6.5): the handler
 * never sends a message directly, it records an INTENT in
 * `notification_outbox` (design.md "Outbox transaccional"), and the outbox
 * consumer (6.12/6.13) owns the transport + retries. So this use case never
 * imports `NotificationPort`; only `NotificationOutboxRepository`.
 */
export class AppointmentReminder {
  constructor(private readonly outbox: NotificationOutboxRepository) {}

  // RED (6.10) — behaviour lands in GREEN 6.11. This stub proves the suite
  // runs and fails first; committing it red keeps the TDD order auditable.
  async execute(input: AppointmentReminderInput): Promise<void> {
    await this.outbox.pickPendingForDelivery();
    throw new Error(`AppointmentReminder.execute not implemented for ${input.appointmentId} — fill in 6.11`);
  }
}
