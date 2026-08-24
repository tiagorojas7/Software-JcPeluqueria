import {
  AppointmentNotFoundError,
  type Appointment,
  type AppointmentRepository,
  type Clock,
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
 */
export class EditAppointmentUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly services: ServiceRepository,
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

    return { ...existing, ...change };
  }
}
