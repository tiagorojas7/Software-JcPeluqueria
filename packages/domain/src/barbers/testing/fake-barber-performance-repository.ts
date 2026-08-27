import type { ActorContext } from '../../access-control';
import type { TimeWindow } from '../../availability';
import type {
  AppointmentStatusCounts,
  BarberPerformanceAccessResult,
  BarberPerformanceRepository,
  BarberStatusCountsResult,
  CompletedAppointmentRecord,
} from '../barber-performance-repository';

const ZERO_COUNTS: AppointmentStatusCounts = { realizado: 0, cancelado: 0, ausente: 0, sin_registrado: 0 };

/**
 * In-memory `BarberPerformanceRepository` test double. `.seed()` takes one
 * barber's already-in-range `realizado` appointments — same convention as
 * `FakeDayBoardRepository`/`FakeAgendaRepository`: the caller decides what
 * belongs to the period by what it seeds, so this fake never re-derives
 * range/status filtering itself. That filtering is Postgres SQL, proved
 * against a real database by `DrizzleBarberPerformanceRepository`'s own
 * Testcontainers spec — this fake only proves orchestration and the
 * `actor.barberId` narrowing.
 *
 * `.seedStatusCounts()` is a SEPARATE store from `.seed()`: `countByStatus`
 * (docs/HUECOS-BACKEND.md #4) answers about every status a turno resolved
 * to, not only `realizado`, so forcing it through the same
 * `CompletedAppointmentRecord` shape — which has no `status` field at all —
 * would mean inventing one nothing else reads.
 */
export class FakeBarberPerformanceRepository implements BarberPerformanceRepository {
  readonly calls: Array<{ requestedBarberId: string; range: TimeWindow; actor: ActorContext }> = [];
  private readonly byBarberId = new Map<string, CompletedAppointmentRecord[]>();
  private readonly statusCountsByBarberId = new Map<string, AppointmentStatusCounts>();

  seed(barberId: string, appointments: CompletedAppointmentRecord[]): void {
    this.byBarberId.set(barberId, appointments);
  }

  seedStatusCounts(barberId: string, counts: Partial<AppointmentStatusCounts>): void {
    this.statusCountsByBarberId.set(barberId, { ...ZERO_COUNTS, ...counts });
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

  async countByStatus(
    requestedBarberId: string,
    _range: TimeWindow,
    actor: ActorContext,
  ): Promise<BarberStatusCountsResult> {
    if (actor.barberId !== undefined && actor.barberId !== requestedBarberId) {
      return { outcome: 'forbidden' };
    }
    return { outcome: 'allowed', counts: this.statusCountsByBarberId.get(requestedBarberId) ?? ZERO_COUNTS };
  }
}
