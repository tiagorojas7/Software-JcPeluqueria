import {
  AppointmentNotFoundError,
  MarkCompletedUseCase,
  type Appointment,
  type AppointmentRepository,
  type Clock,
} from '@jc-barberia/domain';

/**
 * Panel connection for "marcar realizado cualquier turno" (admin-operations
 * spec, "Marcado de realizados y resolución de pendientes"). Wraps the pure
 * domain `MarkCompletedUseCase` (Phase 4.6) with the `findById`/`updateStatus`
 * round-trip `AppointmentRepository` owns — the domain use case is pure by
 * design and persists nothing.
 *
 * Task 10.11 wires this WITHOUT a barber restriction: any appointment is
 * resolvable by the panel regardless of `barberId`. The barberId narrowing
 * (`actor.barberId` when the actor's role is `barber`) is Phase 11 (task
 * 11.13), when barbers get their own scoped endpoint; here the panel's
 * `appointment:mark-completed:any` audience is always owner/secretary, who
 * see every barber's column by construction.
 *
 * Deliberately takes no `actor`, mirroring the underlying domain use case:
 * there is no money to move on `realizado` and the status alone is the unit
 * of write, so unlike `AdminConfirmAbsenceUseCase` there is nothing to record
 * about who performed this transition yet.
 */
export class AdminMarkCompletedUseCase {
  private readonly markCompleted: MarkCompletedUseCase;

  constructor(
    private readonly appointments: AppointmentRepository,
    clock: Clock,
  ) {
    this.markCompleted = new MarkCompletedUseCase(clock);
  }

  async execute(appointmentId: string): Promise<Appointment> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) {
      throw new AppointmentNotFoundError(appointmentId);
    }

    const updated = this.markCompleted.execute({ appointment: existing });
    await this.appointments.updateStatus(appointmentId, updated.status);
    return updated;
  }
}
