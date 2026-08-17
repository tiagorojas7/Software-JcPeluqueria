import type { ActorContext } from '../../access-control';
import type { TimeWindow } from '../../availability';
import type {
  BarberPerformanceAccessResult,
  BarberPerformanceRepository,
  CompletedAppointmentRecord,
} from '../barber-performance-repository';

/**
 * In-memory `BarberPerformanceRepository` test double. `.seed()` takes one
 * barber's already-in-range `realizado` appointments — same convention as
 * `FakeDayBoardRepository`/`FakeAgendaRepository`: the caller decides what
 * belongs to the period by what it seeds, so this fake never re-derives
 * range/status filtering itself. That filtering is Postgres SQL, proved
 * against a real database by `DrizzleBarberPerformanceRepository`'s own
 * Testcontainers spec — this fake only proves orchestration and the
 * `actor.barberId` narrowing.
 */
export class FakeBarberPerformanceRepository implements BarberPerformanceRepository {
  readonly calls: Array<{ requestedBarberId: string; range: TimeWindow; actor: ActorContext }> = [];
  private readonly byBarberId = new Map<string, CompletedAppointmentRecord[]>();

  seed(barberId: string, appointments: CompletedAppointmentRecord[]): void {
    this.byBarberId.set(barberId, appointments);
  }

  async findCompletedAppointments(
    requestedBarberId: string,
    range: TimeWindow,
    actor: ActorContext,
  ): Promise<BarberPerformanceAccessResult> {
    this.calls.push({ requestedBarberId, range, actor });
    if (actor.barberId !== undefined && actor.barberId !== requestedBarberId) {
      return { outcome: 'forbidden' };
    }
    return { outcome: 'allowed', appointments: this.byBarberId.get(requestedBarberId) ?? [] };
  }
}
