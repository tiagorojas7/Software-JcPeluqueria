import type { TimeWindow } from '../../availability';
import type { WalkInOccupancy, WalkInRepository } from '../walk-in';

export interface RecordedWalkInCreateCall {
  readonly occupancy: WalkInOccupancy;
  readonly searchWindow: TimeWindow;
}

/**
 * In-memory `WalkInRepository` test double. Same convention as the other
 * fakes: real `no_overlap_per_barber` conflict detection only exists against
 * PostgreSQL's EXCLUDE constraint (see `DrizzleWalkInRepository`'s
 * Testcontainers suite), so this fake records the create call without ever
 * rejecting — the use case's orchestration is what gets asserted here, the
 * "slot no longer available" behaviour is proven at the infrastructure level.
 */
export class FakeWalkInRepository implements WalkInRepository {
  readonly createCalls: RecordedWalkInCreateCall[] = [];

  async create(occupancy: WalkInOccupancy, searchWindow: TimeWindow): Promise<void> {
    this.createCalls.push({ occupancy, searchWindow });
  }
}
