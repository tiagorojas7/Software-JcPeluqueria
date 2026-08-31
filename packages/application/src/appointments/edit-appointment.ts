import {
  AppointmentNotFoundError,
  type Appointment,
  type AppointmentRepository,
  type BarberRepository,
  type Clock,
  type ClientRepository,
  type NotificationOutboxRepository,
  type ServiceRepository,
  type TimeWindow,
} from '@jc-barberia/domain';

/**
 * Same rule `CreatePhoneAppointmentUseCase` already enforces: the end time is
 * not information a person restates by hand, it is a property of whichever
 * service they picked. An edit that targets a `serviceId` that does not
 * exist fails loudly instead of silently producing a turno with no duration
 * to derive.
 */
export class EditAppointmentServiceNotFoundError extends Error {
  constructor(readonly serviceId: string) {
    super(`No service found with id "${serviceId}"`);
    this.name = 'EditAppointmentServiceNotFoundError';
  }
}

export interface EditAppointmentInput {
  readonly appointmentId: string;
  readonly barberId: string;
  readonly serviceId: string;
  /** Shop-local instant the turno now starts. The end is never supplied by
   *  the caller — it is always derived from the TARGET service's
   *  `durationMinutes` (see `EditAppointmentServiceNotFoundError`'s doc
   *  comment), so no caller can leave a turno whose stored duration
   *  disagrees with its service, even when the edit changes the service
   *  itself. */
  readonly startsAt: Date;
  /** Where alternatives are searched if the target range is already taken. */
  readonly searchWindow: TimeWindow;
}

/**
 * Edits service, barber or horario of "cualquier turno" (admin-operations
 * spec, "Edición y cancelación administrativa") — no channel or status
 * restriction, matching the spec's literal wording. Delegates the actual
 * write, and the exclusivity check against a conflicting target range, to
 * `AppointmentRepository.updateSchedule`.
 *
 * panel-usable: "nobody tells the client their appointment changed" —
 * fires an `appointment_updated` notification on every successful edit, the
 * same transactional-outbox pattern `ProcessPaymentUseCase.notifyBookingConfirmed`
 * already established (writes to `NotificationOutboxRepository`, NEVER
 * `NotificationPort` directly — the worker's consumer dispatches it). Gated
 * on the client having an email registrado, same gate every other
 * outbox-writing use case in this codebase already applies: no email, no
 * dispatch, never a crash on the edit itself.
 */
export class EditAppointmentUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly services: ServiceRepository,
    private readonly barbers: BarberRepository,
    private readonly clients: ClientRepository,
    private readonly outbox: NotificationOutboxRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: EditAppointmentInput): Promise<Appointment> {
    const existing = await this.appointments.findById(input.appointmentId);
    if (!existing) {
      throw new AppointmentNotFoundError(input.appointmentId);
    }

    const service = await this.services.findById(input.serviceId);
    if (!service) {
      throw new EditAppointmentServiceNotFoundError(input.serviceId);
    }

    const timeRange: TimeWindow = {
      start: input.startsAt,
      end: this.clock.addMinutes(input.startsAt, service.durationMinutes),
    };

    const change = {
      barberId: input.barberId,
      serviceId: input.serviceId,
      timeRange,
    };
    await this.appointments.updateSchedule(input.appointmentId, change, input.searchWindow);

    await this.notifyAppointmentUpdated(existing.clientId, input.barberId, service.name, timeRange.start);

    return { ...existing, ...change };
  }

  /** Same "never crash the write over a notification" posture
   *  `ProcessPaymentUseCase.notifyBookingConfirmed`/
   *  `GenerateAbsenceReassignmentOffers.notifyClient` already establish: the
   *  edit itself already succeeded by the time this runs, so a missing
   *  client/email/barber degrades this to a no-op, never a thrown error.
   *  `clientId` is null for an edited walk-in with no identified customer —
   *  same no-op, one step earlier than the lookup. */
  private async notifyAppointmentUpdated(
    clientId: string | null,
    barberId: string,
    serviceName: string,
    startsAt: Date,
  ): Promise<void> {
    if (!clientId) {
      return;
    }
    const client = await this.clients.findById(clientId);
    if (!client || !client.email) {
      return;
    }
    const barber = await this.barbers.findById(barberId);
    await this.outbox.enqueue({
      notificationType: 'appointment_updated',
      recipientEmail: client.email,
      payload: {
        barberName: barber?.name ?? '',
        serviceName,
        appointmentTime: startsAt.toISOString(),
      },
    });
  }
}
