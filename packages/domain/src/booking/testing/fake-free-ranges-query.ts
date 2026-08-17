import type { TimeWindow } from '../../availability';
import type { FreeRangesQuery } from '../free-ranges-query';

/**
 * In-memory `FreeRangesQuery` test double — seeded per barber with whatever
 * `TimeWindow[]` the test wants "already free" to look like, same role every
 * other `Fake*Repository` in this codebase plays: no real interval-subtraction
 * logic here (that only exists against PostgreSQL, see `freeRanges` in
 * `packages/infrastructure`), just enough to drive
 * `GetPublicAvailabilityUseCase`'s orchestration without a database.
 */
export class FakeFreeRangesQuery implements FreeRangesQuery {
  private readonly byBarber = new Map<string, TimeWindow[]>();
  readonly calls: { barberId: string; searchWindow: TimeWindow }[] = [];

  seed(barberId: string, freeRanges: TimeWindow[]): void {
    this.byBarber.set(barberId, freeRanges);
  }

  async findFreeRanges(barberId: string, searchWindow: TimeWindow): Promise<TimeWindow[]> {
    this.calls.push({ barberId, searchWindow });
    return this.byBarber.get(barberId) ?? [];
  }
}
