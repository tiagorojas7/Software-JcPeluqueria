import {
  AppointmentNotFoundError,
  ConfirmAbsenceUseCase,
  type AbsenceRecordRepository,
  type ActorContext,
  type AppointmentRepository,
  type Clock,
  type ConfirmAbsenceResult,
} from '@jc-barberia/domain';

export type BarberConfirmAbsenceResult =
  | { readonly outcome: 'forbidden' }
  | ({ readonly outcome: 'confirmed' } & ConfirmAbsenceResult);

/**
 * barber-profile spec, "Resolución de los turnos propios": a barber may
 * resolve their OWN `sin_registrado` appointment to `ausente`, seña or no
 * seña. Sibling of `AdminConfirmAbsenceUseCase` (Phase 10, no barber
 * restriction) — see `BarberMarkCompletedUseCase`'s doc comment for why this
 * stays a separate class. Reuses the exact same domain `ConfirmAbsenceUseCase`
 * and `AbsenceRecordRepository` round-trip, so the deposit-forfeiture switch
 * and the "no automatic absence" human-actor guard (appointment-lifecycle
 * spec) are never duplicated here.
 *
 * The ownership check runs on the already-fetched single row, strictly
 * before any write — task 11.13's "acotar ... con `barberId =
 * actor.barberId`".
 */
export class BarberConfirmAbsenceUseCase {
  private readonly confirmAbsence: ConfirmAbsenceUseCase;

  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly absences: AbsenceRecordRepository,
    clock: Clock,
  ) {
    this.confirmAbsence = new ConfirmAbsenceUseCase(clock);
  }

  async execute(appointmentId: string, actor: ActorContext): Promise<BarberConfirmAbsenceResult> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) {
      throw new AppointmentNotFoundError(appointmentId);
    }
    if (existing.barberId !== actor.barberId) {
      return { outcome: 'forbidden' };
    }

    const result = this.confirmAbsence.execute({ appointment: existing, actor });
    await this.appointments.updateStatus(appointmentId, result.appointment.status);
    await this.absences.record(result.absence);
    return { outcome: 'confirmed', ...result };
  }
}
