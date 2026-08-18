import type { ExpiredHoldView, HoldExpireViewRepository } from '@jc-barberia/domain';
import { alias } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { clients } from '../db/schema/clients';
import { slotOccupancies } from '../db/schema/slot-occupancy';

/**
 * The Drizzle half of task A.5 ("Cablear el handler hold.expire") — the one
 * infra piece `ExpireHold` needed that never existed: design.md documents the
 * job (line 144) and `hold-expire.spec.ts` proves the use case against
 * `FakeHoldExpireViewRepository`, but nothing ever read `slot_occupancies`
 * for it before this file.
 *
 * Placed alongside `pg-boss-hold-expire-scheduler.ts` (not under
 * `notifications/`) because this repository reads booking state, not
 * notification state — same folder the domain port's own analog
 * (`packages/domain/src/booking/expired-hold-view.ts`) lives in. It only
 * exists to let `ExpireHold` decide the two effects that "corresponden": the
 * origin seña refund and the cancellation notification.
 *
 * One query, two self-joins: the hold row itself (`isHeld`/`paymentPending`/
 * `originOccupancyId`) and — only meaningful when `origin_occupancy_id` is
 * set (an absence-offer hold) — the ORIGIN appointment's own client's email.
 * The origin's client is read explicitly through its own `client_id` rather
 * than assumed equal to the hold row's, so this stays correct even if a
 * future flow ever let them diverge.
 */
export class DrizzleHoldExpireViewRepository implements HoldExpireViewRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async loadForExpire(holdId: string): Promise<ExpiredHoldView | null> {
    const origin = alias(slotOccupancies, 'origin');
    const originClient = alias(clients, 'origin_client');

    const rows = await this.db
      .select({
        status: slotOccupancies.status,
        paymentPending: slotOccupancies.paymentPending,
        originOccupancyId: slotOccupancies.originOccupancyId,
        originClientEmail: originClient.email,
      })
      .from(slotOccupancies)
      .leftJoin(origin, eq(origin.id, slotOccupancies.originOccupancyId))
      .leftJoin(originClient, eq(originClient.id, origin.clientId))
      .where(eq(slotOccupancies.id, holdId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      holdId,
      isHeld: row.status === 'held',
      paymentPending: row.paymentPending,
      originOccupancyId: row.originOccupancyId,
      originClientEmail: row.originClientEmail,
    };
  }
}
