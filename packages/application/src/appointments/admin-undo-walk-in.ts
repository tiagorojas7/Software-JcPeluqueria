import {
  AppointmentNotFoundError,
  UndoWalkInUseCase,
  type Appointment,
  type AppointmentRepository,
} from '@jc-barberia/domain';

/**
 * Panel connection for undoing a walk-in loaded by mistake (see
 * `UndoWalkInUseCase`'s doc comment for why this is the one deliberate
 * exception to `realizado` being terminal). Wraps the pure domain use case
 * with the `findById`/`updateStatus` round-trip `AppointmentRepository`
 * owns, mirroring `AdminCancelAppointmentUseCase`/`AdminMarkCompletedUseCase`'s
 * own shape.
 *
 * Setting the status to `cancelado` is enough to free the slot: the
 * `no_overlap_per_barber` EXCLUDE constraint (migration 0003) only applies
 * `WHERE status IN ('held', 'reservado', 'realizado')` — `cancelado` falls
 * outside that predicate, so the barber's time immediately becomes available
 * again, the exact same mechanism `AdminCancelAppointmentUseCase` already
 * relies on.
 *
 * Deliberately takes no `PaymentPort`, mirroring `UndoWalkInUseCase` itself:
 * a walk-in never carries a seña, so there is never money to resolve here.
 */
export class AdminUndoWalkInUseCase {
  private readonly undoWalkIn = new UndoWalkInUseCase();

  constructor(private readonly appointments: AppointmentRepository) {}

  async execute(appointmentId: string): Promise<Appointment> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) {
      throw new AppointmentNotFoundError(appointmentId);
    }

    const updated = this.undoWalkIn.execute(existing);
    await this.appointments.updateStatus(appointmentId, updated.status);
    return updated;
  }
}
