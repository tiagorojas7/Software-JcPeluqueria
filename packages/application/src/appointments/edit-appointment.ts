import {
  AppointmentNotFoundError,
  type Appointment,
  type AppointmentRepository,
  type TimeWindow,
} from '@jc-barberia/domain';

export interface EditAppointmentInput {
  readonly appointmentId: string;
  readonly barberId: string;
  readonly serviceId: string;
  readonly timeRange: TimeWindow;
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
  constructor(private readonly appointments: AppointmentRepository) {}

  async execute(input: EditAppointmentInput): Promise<Appointment> {
    const existing = await this.appointments.findById(input.appointmentId);
    if (!existing) {
      throw new AppointmentNotFoundError(input.appointmentId);
    }

    const change = {
      barberId: input.barberId,
      serviceId: input.serviceId,
      timeRange: input.timeRange,
    };
    await this.appointments.updateSchedule(input.appointmentId, change, input.searchWindow);

    return { ...existing, ...change };
  }
}
