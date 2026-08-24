import type { Barber, BarberRepository } from '@jc-barberia/domain';

export interface ListPublicBarbersResult {
  readonly barbers: readonly Barber[];
}

/**
 * client-booking spec, "Exploración sin cuenta": a visitor MUST be able to
 * consult "servicios, barberos y horarios disponibles" without an account —
 * same public, session-free shape as `GetPublicAvailabilityUseCase`. The
 * ONLY rule this class enforces is the one the owner's bug report named
 * directly: a barber deactivated through the panel (`active = false`) must
 * never reach a visitor, ever. `GetPublicAvailabilityUseCase` already
 * refuses to book a deactivated barber (`!barber.active` short-circuits to
 * empty slots); this use case is what keeps them off the list in the first
 * place, so the UI and the availability engine agree.
 */
export class ListPublicBarbersUseCase {
  constructor(private readonly barbers: BarberRepository) {}

  async execute(): Promise<ListPublicBarbersResult> {
    const all = await this.barbers.list();
    return { barbers: all.filter((barber) => barber.active) };
  }
}
