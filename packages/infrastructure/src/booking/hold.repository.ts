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
        originOccupancyId: hold.originOccupancyId,
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

  /** Read path only — never a source of a write decision (see the port's
   *  own doc comment). Reuses the same `lower()`/`upper()` + `.mapWith`
   *  decoding `freeRanges` already established for `tstzrange`. */
  async findById(holdId: string): Promise<Hold | null> {
    const rows = await this.db
      .select({
        id: slotOccupancies.id,
        barberId: slotOccupancies.barberId,
        serviceId: slotOccupancies.serviceId,
        clientId: slotOccupancies.clientId,
        channel: slotOccupancies.channel,
        start: sql`lower(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
        end: sql`upper(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
        holdExpiresAt: slotOccupancies.holdExpiresAt,
        originOccupancyId: slotOccupancies.originOccupancyId,
      })
      .from(slotOccupancies)
      .where(eq(slotOccupancies.id, holdId));

    const row = rows[0];
    if (!row || !row.holdExpiresAt) {
      return null;
    }
    return {
      id: row.id,
      barberId: row.barberId,
      serviceId: row.serviceId,
      clientId: row.clientId,
      channel: row.channel as Hold['channel'],
      timeRange: { start: row.start as Date, end: row.end as Date },
      holdExpiresAt: row.holdExpiresAt,
      originOccupancyId: row.originOccupancyId,
    };
  }

  /**
   * Same re-validate-then-write shape as `confirm()`, but transitions to
   * `liberado` instead of `reservado` — the accept-offer path
   * (`AcceptOfferUseCase`) uses this to vacate an offer hold's EXCLUDE-
   * protected range before `AppointmentRepository.updateSchedule` claims that
   * exact (barberId, timeRange) for the original appointment. `false` means
   * the hold already expired or was consumed by something else — never a
   * second write.
   */
  async release(holdId: string): Promise<boolean> {
    const rows = await this.db
      .update(slotOccupancies)
      .set({ status: 'liberado' })
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
   * Attaches the client identified at the end of the web flow
   * (client-booking: "Cuenta sin contraseña creada al final del flujo") —
   * re-validates `status = 'held'` in the same statement, the identical
   * re-validate-then-write shape `confirm()`/`beginCheckout()` already use.
   */
  async attachClient(holdId: string, clientId: string): Promise<boolean> {
    const rows = await this.db
      .update(slotOccupancies)
      .set({ clientId })
      .where(and(eq(slotOccupancies.id, holdId), eq(slotOccupancies.status, 'held')))
      .returning({ id: slotOccupancies.id });
    return rows.length > 0;
  }
}
