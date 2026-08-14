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
      throw new SlotUnavailableError(await this.freeRanges(hold.barberId, searchWindow));
    }
  }

  /**
   * The `EXCLUDE` predicate cannot reference `now()` (not immutable), so an
   * expired hold nobody confirmed or released would keep occupying forever
   * otherwise. Evaluated lazily, right before the range is written or read,
   * scoped to `window` — only what is about to be touched needs releasing.
   *
   * Task 5.18 — design.md line 150: a hold with `payment_pending = true` is
   * NEVER released by the timer, even past its wall-clock expiry. It keeps
   * occupying the range until `ProcessPaymentUseCase` itself reaches a
   * terminal payment state (approved → confirm to `reservado`; rejected/
   * cancelled → `releaseHoldOnRejectedPayment`). This is what prevents the
   * "paid at 14:50, hold expired, approved payment with no slot" race —
   * the row stays held and the EXCLUDE keeps blocking competitors.
   */
  private async releaseExpiredHolds(barberId: string, window: TimeWindow): Promise<void> {
    await this.db
      .update(slotOccupancies)
      .set({ status: 'liberado' })
      .where(
        and(
          eq(slotOccupancies.barberId, barberId),
          eq(slotOccupancies.status, 'held'),
          eq(slotOccupancies.paymentPending, false),
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

  /**
   * Same re-validate-and-transition shape as `confirm()`, but stays `held`:
   * it only flips `payment_pending` and pushes `hold_expires_at` out to
   * `paymentExpiresAt` (design.md's checkout sequence). `false` means the
   * hold already expired or was consumed — never a second write is issued.
   */
  async beginCheckout(holdId: string, paymentExpiresAt: Date): Promise<boolean> {
    const rows = await this.db
      .update(slotOccupancies)
      .set({ paymentPending: true, holdExpiresAt: paymentExpiresAt })
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
