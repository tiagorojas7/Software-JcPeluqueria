import { SlotUnavailableError, type Hold, type HoldRepository, type TimeWindow } from '@jc-barberia/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { OCCUPYING_STATUSES, slotOccupancies } from '../db/schema/slot-occupancy';

const EXCLUSION_VIOLATION = '23P01';

/** Half-open `[start,end)`, so 10:00-10:30 and 10:30-11:00 do not overlap. */
const toRangeLiteral = ({ start, end }: TimeWindow): string =>
  `[${start.toISOString()},${end.toISOString()})`;

// Drizzle raises the driver error directly in some paths and wrapped in
// others, so both shapes are inspected rather than trusting one.
const isExclusionViolation = (error: unknown): boolean => {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return (
    candidate?.code === EXCLUSION_VIOLATION || candidate?.cause?.code === EXCLUSION_VIOLATION
  );
};

/**
 * Writes against the `no_overlap_per_barber` EXCLUDE constraint and turns its
 * `23P01` into a domain-level rejection. There is deliberately no "is it
 * free?" query before the insert: that read-then-write is exactly the race
 * that produces double booking, and the database already answers it
 * atomically.
 */
export class DrizzleHoldRepository implements HoldRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async create(hold: Hold, searchWindow: TimeWindow): Promise<void> {
    try {
      await this.db.insert(slotOccupancies).values({
        id: hold.id,
        barberId: hold.barberId,
        serviceId: hold.serviceId,
        clientId: hold.clientId,
        channel: hold.channel,
        status: 'held',
        timeRange: toRangeLiteral(hold.timeRange),
        holdExpiresAt: hold.holdExpiresAt,
      });
    } catch (error) {
      if (!isExclusionViolation(error)) {
        throw error;
      }
      throw new SlotUnavailableError(await this.freeRanges(hold.barberId, searchWindow));
    }
  }

  /** `searchWindow` minus everything that still occupies the barber inside it. */
  private async freeRanges(barberId: string, searchWindow: TimeWindow): Promise<TimeWindow[]> {
    const lowerBound = sql`lower(${slotOccupancies.timeRange})`;
    // `.mapWith` borrows a timestamptz column's decoder: attaching Drizzle to
    // a postgres-js client disables the driver's own timestamp parsing, so a
    // bare `sql` expression would come back as a raw string.
    const occupied = await this.db
      .select({
        start: lowerBound.mapWith(slotOccupancies.holdExpiresAt),
        end: sql`upper(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
      })
      .from(slotOccupancies)
      .where(
        and(
          eq(slotOccupancies.barberId, barberId),
          inArray(slotOccupancies.status, [...OCCUPYING_STATUSES]),
          sql`${slotOccupancies.timeRange} && ${toRangeLiteral(searchWindow)}::tstzrange`,
        ),
      )
      .orderBy(lowerBound);

    const free: TimeWindow[] = [];
    let cursor = searchWindow.start;
    for (const { start, end } of occupied) {
      if (start > cursor) {
        free.push({ start: cursor, end: start });
      }
      if (end > cursor) {
        cursor = end;
      }
    }
    if (cursor < searchWindow.end) {
      free.push({ start: cursor, end: searchWindow.end });
    }
    return free;
  }
}
