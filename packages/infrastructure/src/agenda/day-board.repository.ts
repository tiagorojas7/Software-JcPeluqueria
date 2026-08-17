import type { ActorContext, Clock, DayBoardQueryResult, DayBoardRepository } from '@jc-barberia/domain';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { barbers } from '../db/schema/availability';
import { slotOccupancies } from '../db/schema/slot-occupancy';

/** design.md: `held`/`liberado` are "anteriores al ciclo de vida del turno"
 *  — a hold mid-checkout is not yet a turno the day board shows. */
const EXCLUDED_STATUSES = ['held', 'liberado'] as const;

export class DrizzleDayBoardRepository implements DayBoardRepository {
  constructor(
    private readonly db: PostgresJsDatabase,
    private readonly clock: Clock,
  ) {}

  /** Narrows both queries to `actor.barberId` in the `WHERE` clause itself
   *  when the actor is a barber — never a post-fetch filter over every
   *  barber's rows (task 8.7, reusing 3b.7's rule; see the port's own doc
   *  comment). */
  async findDayBoard(calendarDate: string, actor: ActorContext): Promise<DayBoardQueryResult> {
    const { start, end } = this.clock.businessDayBounds(calendarDate);
    const rangeLiteral = `[${start.toISOString()},${end.toISOString()})`;

    const columns =
      actor.barberId !== undefined
        ? await this.selectColumns().where(eq(barbers.id, actor.barberId))
        : await this.selectColumns();

    const inWindow = and(
      notInArray(slotOccupancies.status, [...EXCLUDED_STATUSES]),
      sql`${slotOccupancies.timeRange} && ${rangeLiteral}::tstzrange`,
    );
    const slots =
      actor.barberId !== undefined
        ? await this.selectSlots().where(and(inWindow, eq(slotOccupancies.barberId, actor.barberId)))
        : await this.selectSlots().where(inWindow);

    return { columns, slots };
  }

  private selectColumns() {
    return this.db.select({ barberId: barbers.id, barberName: barbers.name }).from(barbers);
  }

  private selectSlots() {
    // `.mapWith` borrows the `holdExpiresAt` timestamptz column's decoder —
    // same technique as DrizzleHoldRepository.freeRanges — so `startsAt`/
    // `endsAt` come back as real `Date`s, not raw strings.
    return this.db
      .select({
        id: slotOccupancies.id,
        barberId: slotOccupancies.barberId,
        serviceId: slotOccupancies.serviceId,
        clientId: slotOccupancies.clientId,
        status: slotOccupancies.status,
        startsAt: sql`lower(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
        endsAt: sql`upper(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
      })
      .from(slotOccupancies);
  }
}
