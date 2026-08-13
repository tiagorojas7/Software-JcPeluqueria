import type { BarberSchedule } from '../../availability';
import type { ActorContext } from '../actor-context';
import type { AgendaAccessResult, AgendaRepository } from '../agenda-repository';

/** In-memory `AgendaRepository` test double. Applies the exact same
 *  narrowing rule the port's doc comment mandates, so callers (e.g. an HTTP
 *  contract test exercising Nest wiring without a real database) observe
 *  the same allowed/forbidden shape the Drizzle adapter proves against
 *  Postgres in its own Testcontainers spec. */
export class FakeAgendaRepository implements AgendaRepository {
  private readonly byBarberId = new Map<string, BarberSchedule[]>();

  seed(barberId: string, schedule: BarberSchedule[]): void {
    this.byBarberId.set(barberId, schedule);
  }

  async findScheduleFor(requestedBarberId: string, actor: ActorContext): Promise<AgendaAccessResult> {
    if (actor.barberId !== undefined && actor.barberId !== requestedBarberId) {
      return { outcome: 'forbidden' };
    }
    return { outcome: 'allowed', schedule: this.byBarberId.get(requestedBarberId) ?? [] };
  }
}
