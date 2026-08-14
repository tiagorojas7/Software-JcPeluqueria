import {
  AppointmentNotFoundError,
  ConfirmAbsenceUseCase,
  type AbsenceRecordRepository,
  type ActorContext,
  type Appointment,
  type AppointmentRepository,
  type Clock,
  type ConfirmAbsenceResult,
} from '@jc-barberia/domain';

/**
 * Panel connection for "resolver sin_registrar como ausente" (admin-operations
 * spec, "Marcado de realizados y resolución de pendientes"). Wraps the pure
 * domain `ConfirmAbsenceUseCase` (Phase 4.8) with the `findById`/`updateStatus`
 * round-trip and, critically, the persistence of the `AbsenceRecord` into the
 * absence-history table — the exact seam `ConfirmAbsenceUseCase` refused to
 * own until "whichever phase wires it to a repository" arrived. Phase 10 is
 * that phase.
 *
 * Task 10.11 wires this WITHOUT a barber restriction: any `sin_registrar`
 * appointment is resolvable by the panel regardless of `barberId`. The
 * barberId narrowing is Phase 11 (task 11.13) only. `actor` is required
 * here, not because the panel restricts by barber, but because the domain use
 * case itself refuses to mark an absence without a real human confirmation
 * (appointment-lifecycle spec, "El sistema nunca marca ausencias por su
 * cuenta") — that guard lives in the domain, untouched by this wrapper.
 */
export class AdminConfirmAbsenceUseCase {
  private readonly confirmAbsence: ConfirmAbsenceUseCase;

  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly absences: AbsenceRecordRepository,
    clock: Clock,
  ) {
    this.confirmAbsence = new ConfirmAbsenceUseCase(clock);
  }

  async execute(appointmentId: string, actor: ActorContext): Promise<ConfirmAbsenceResult> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) {
      throw new AppointmentNotFoundError(appointmentId);
    }

    const result = this.confirmAbsence.execute({ appointment: existing, actor });
    await this.appointments.updateStatus(appointmentId, result.appointment.status);
    await this.absences.record(result.absence);
    return result;
  }

  /** Exposed for tests/inspection that want the domain use case's pure form. */
  protected get domain(): ConfirmAbsenceUseCase {
    return this.confirmAbsence;
  }
}

export type { Appointment };
