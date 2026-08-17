import type { TimeWindow } from '../availability';

/**
 * Read-only occupancy query: everything still free for one barber inside
 * `searchWindow`, with every `held`/`reservado`/`realizado` range already
 * subtracted. The Postgres-backed implementation reuses the exact same
 * `freeRanges` SQL `DrizzleHoldRepository` already uses to build
 * `SlotUnavailableError.alternatives` — this port only gives that same query
 * a READ path callers can use before ever attempting to create a hold
 * (client-booking: "Exploración sin cuenta" browses availability first, with
 * no write and no account).
 */
export interface FreeRangesQuery {
  findFreeRanges(barberId: string, searchWindow: TimeWindow): Promise<TimeWindow[]>;
}
