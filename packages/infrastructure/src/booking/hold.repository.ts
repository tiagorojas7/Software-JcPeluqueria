import { SlotUnavailableError, type Hold, type HoldRepository, type TimeWindow } from '@jc-barberia/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { freeRanges, isExclusionViolation, toRangeLiteral } from '../db/occupancy-sql';
import { slotOccupancies } from '../db/schema/slot-occupancy';

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
    await this.releaseExpiredHolds(hold.barberId, searchWindow);
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
      throw new SlotUnavailableError(await freeRanges(this.db, hold.barberId, searchWindow));
    }
  }

  /**
   * The `EXCLUDE` predicate cannot reference `now()` (not immutable), so an
   * expired hold nobody confirmed or released would keep occupying forever
   * otherwise. Evaluated lazily, right before the range is written or read,
   * scoped to `window` — only what is about to be touched needs releasing.
   */
  private async releaseExpiredHolds(barberId: string, window: TimeWindow): Promise<void> {
    await this.db
      .update(slotOccupancies)
      .set({ status: 'liberado' })
      .where(
        and(
          eq(slotOccupancies.barberId, barberId),
          eq(slotOccupancies.status, 'held'),
          sql`${slotOccupancies.holdExpiresAt} <= now()`,
          sql`${slotOccupancies.timeRange} && ${toRangeLiteral(window)}::tstzrange`,
        ),
      );
  }

  /**
   * Re-validates and confirms in one atomic statement — never a `SELECT`
   * then an `UPDATE`, and never a second `INSERT`. Zero rows updated means
   * the hold expired or was already consumed by something else; the caller
   * (`ConfirmHold`) treats that as a failed re-validation, not an error.
   */
  async confirm(holdId: string): Promise<boolean> {
    const rows = await this.db
      .update(slotOccupancies)
      .set({ status: 'reservado' })
      .where(
        and(
          eq(slotOccupancies.id, holdId),
          eq(slotOccupancies.status, 'held'),
          sql`${slotOccupancies.holdExpiresAt} > now()`,
        ),
      )
      .returning({ id: slotOccupancies.id });
    return rows.length > 0;
  }
}
