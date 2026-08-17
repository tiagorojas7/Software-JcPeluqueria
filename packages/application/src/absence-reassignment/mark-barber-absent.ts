import type { Appointment, AppointmentRepository, TimeWindow } from '@jc-barberia/domain';

export interface MarkBarberAbsentInput {
  readonly barberId: string;
  readonly timeRange: TimeWindow;
}

/**
 * barber-absence-reassignment spec, "Detección de turnos afectados": the
 * first step of the whole reassignment flow. Takes the `AppointmentRepository`
 * PORT — never a plain `Appointment[]` array — so the scoping (which turnos
 * count as "affected") lives in exactly one place, the repository's query,
 * the same narrowing pattern `AgendaRepository`/`BarberPerformanceRepository`
 * already use for their own actor-scoped reads. A prior rejected
 * implementation took a `Hold[]` constructor argument instead; that broke
 * the hexagonal boundary every other use case in this codebase follows and
 * is deliberately not repeated here.
 *
 * Detection only — generating same-day offers for what this returns is
 * `GenerateAbsenceReassignmentOffers`'s job (task 12.3/12.4), composed by the
 * caller (the controller), not by this class.
 */
export class MarkBarberAbsentUseCase {
  constructor(private readonly appointments: AppointmentRepository) {}

  async execute(input: MarkBarberAbsentInput): Promise<Appointment[]> {
    return this.appointments.findReservedByBarberInRange(input.barberId, input.timeRange);
  }
}
