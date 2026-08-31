import {
  AppointmentNotFoundError,
  MarkCompletedUseCase,
  type ActorContext,
  type Appointment,
  type AppointmentRepository,
  type Clock,
} from '@jc-barberia/domain';

export type BarberMarkCompletedResult =
  | { readonly outcome: 'forbidden' }
  | { readonly outcome: 'completed'; readonly appointment: Appointment };

/**
 * barber-profile spec, "Resolución de los turnos propios": a barber may mark
 * their OWN `reservado`/`sin_registrado` appointment `realizado`. Sibling of
 * `AdminMarkCompletedUseCase` (Phase 10, no barber restriction) — kept as a
 * separate class rather than an `if (actor)` branch bolted onto the admin
 * one, the same way `SelfCancelAppointmentUseCase` stays separate from
 * `AdminCancelAppointmentUseCase`: two distinct authorization policies over
 * the same domain operation read clearer apart than merged.
 *
 * The ownership check runs on the ALREADY-FETCHED single row (`findById` is
 * an address-by-primary-key read, never a query scoped to a colleague's id)
 * and strictly BEFORE any write — task 11.13's "acotar ... con `barberId =
 * actor.barberId`".
 */
export class BarberMarkCompletedUseCase {
  private readonly markCompleted: MarkCompletedUseCase;

  constructor(
    private readonly appointments: AppointmentRepository,
    clock: Clock,
  ) {
    this.markCompleted = new MarkCompletedUseCase(clock);
  }

  async execute(appointmentId: string, actor: ActorContext): Promise<BarberMarkCompletedResult> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) {
      throw new AppointmentNotFoundError(appointmentId);
    }
    if (existing.barberId !== actor.barberId) {
      return { outcome: 'forbidden' };
    }

    const updated = this.markCompleted.execute({ appointment: existing });
    await this.appointments.updateStatus(appointmentId, updated.status);
    return { outcome: 'completed', appointment: updated };
  }
}
