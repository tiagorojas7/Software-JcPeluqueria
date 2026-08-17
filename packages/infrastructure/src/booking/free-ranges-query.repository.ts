import type { FreeRangesQuery, TimeWindow } from '@jc-barberia/domain';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { freeRanges } from '../db/occupancy-sql';

/**
 * Thin adapter over the exact same `freeRanges` query
 * `DrizzleHoldRepository` already uses internally to build
 * `SlotUnavailableError.alternatives` — see that function's own doc comment.
 * No new SQL: this only exposes it as a standalone read port so
 * `GetPublicAvailabilityUseCase` can call it before ever attempting a write.
 */
export class DrizzleFreeRangesQuery implements FreeRangesQuery {
  constructor(private readonly db: PostgresJsDatabase) {}

  findFreeRanges(barberId: string, searchWindow: TimeWindow): Promise<TimeWindow[]> {
    return freeRanges(this.db, barberId, searchWindow);
  }
}
