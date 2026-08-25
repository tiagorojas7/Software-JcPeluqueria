import {
  type AppointmentReminderScheduler,
  type BarberRepository,
  type Clock,
  REMINDER_LEAD_MINUTES,
  type NotificationOutboxRepository,
  type NotificationTemplate,
  type ServiceRepository,
} from '@jc-barberia/domain';

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
  /** Resolved to a NAME here and carried in the payload — see the class doc
   *  for why the name travels with the intent instead of being read at
   *  delivery time. */
  readonly barberId: string;
  readonly serviceId: string;
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
 *
 * Idempotency: a retried job would enqueue a second intent row. Phase 7's
 * Drizzle outbox impl can key on `(notification_type, appointmentId)` to
 * dedupe; this slice deliberately ships the dispatch contract only, per the
 * brief ("solo el evento del outbox").
 */
export class AppointmentReminder {
  constructor(
    private readonly outbox: NotificationOutboxRepository,
    private readonly barbers: BarberRepository,
    private readonly services: ServiceRepository,
  ) {}

  async execute(input: AppointmentReminderInput): Promise<void> {
    // The email gate is the ONLY gate — notification-port spec: both channels
    // get the reminder, with or without seña, never without an email. A null
    // email returns BEFORE enqueueing, so the outbox never holds a row that
    // cannot be delivered (the only channel implemented in the MVP is email).
    // It also returns before the two lookups below: nothing to render means
    // nothing worth reading.
    if (input.clientEmail === null) return;

    // Resolved HERE, not by the template: the outbox row is what the consumer
    // delivers — minutes later, or several retries later — and a template that
    // re-read the barber's name at delivery time would let a rename rewrite a
    // message about a turno that was already booked. A dangling id costs the
    // client one LINE (the template drops it), never the reminder itself, the
    // same posture `ProcessPaymentUseCase.notifyBookingConfirmed` takes.
    const [barber, service] = await Promise.all([
      this.barbers.findById(input.barberId),
      this.services.findById(input.serviceId),
    ]);

    const notificationType: NotificationTemplate = input.hasSettledDeposit
      ? 'reminder_with_deposit'
      : 'reminder_without_deposit';
    await this.outbox.enqueue({
      notificationType,
      recipientEmail: input.clientEmail,
      payload: {
        appointmentId: input.appointmentId,
        appointmentTime: input.appointmentTime,
        barberName: barber?.name ?? '',
        serviceName: service?.name ?? '',
      },
    });
  }
}

/**
 * "Schedule dinámico por turno": rather than a cron that scans, EVERY
 * appointment owns its own `appointment.reminder` job enqueued at
 * `appointmentStart - REMINDER_LEAD_MINUTES` — the brief's explicit contrast
 * with a fixed cron. The confirm path calls this right after the appointment
 * reaches `reservado`, using the SAME `Clock` that computed the appointment's
 * start, never a fresh wall-clock read; the scheduler's pg-boss adapter owns
 * the transactional-same-statement guarantee (same shape as `CreateHold`
 * enqueuing `hold.expire` in 6.2/6.3).
 */
export class ScheduleAppointmentReminder {
  constructor(
    private readonly clock: Clock,
    private readonly scheduler: AppointmentReminderScheduler,
  ) {}

  async execute(input: { readonly appointmentId: string; readonly appointmentStart: Date }): Promise<void> {
    const startAfter = this.clock.addMinutes(input.appointmentStart, -REMINDER_LEAD_MINUTES);
    await this.scheduler.scheduleReminder({ appointmentId: input.appointmentId, startAfter });
  }
}
