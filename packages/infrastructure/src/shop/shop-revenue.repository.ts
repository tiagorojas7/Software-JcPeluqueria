import type { ShopRevenueRecord, ShopRevenueRepository, TimeWindow } from '@jc-barberia/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { barbers, services } from '../db/schema/availability';
import { slotOccupancies } from '../db/schema/slot-occupancy';

/**
 * docs/HUECOS-BACKEND.md #5 — the shop-wide sibling of
 * `DrizzleBarberPerformanceRepository`: every `realizado` turno in `range`,
 * across every barber, joined to both `barbers` and `services` for the
 * names its own breakdowns need. No narrowing predicate on `barber_id` at
 * all — that IS the difference from the per-barber repository, not an
 * oversight.
 */
export class DrizzleShopRevenueRepository implements ShopRevenueRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async findCompletedAppointments(range: TimeWindow): Promise<readonly ShopRevenueRecord[]> {
    const rangeLiteral = `[${range.start.toISOString()},${range.end.toISOString()})`;
    return this.db
      .select({
        appointmentId: slotOccupancies.id,
        barberId: slotOccupancies.barberId,
        barberName: barbers.name,
        serviceId: slotOccupancies.serviceId,
        serviceName: services.name,
        listPriceCents: services.priceCents,
      })
      .from(slotOccupancies)
      .innerJoin(services, eq(services.id, slotOccupancies.serviceId))
      .innerJoin(barbers, eq(barbers.id, slotOccupancies.barberId))
      .where(
        and(
          // Only realizado counts toward the shop's own billing — same
          // rule `DrizzleBarberPerformanceRepository` applies for one barber.
          eq(slotOccupancies.status, 'realizado'),
          sql`${slotOccupancies.timeRange} && ${rangeLiteral}::tstzrange`,
        ),
      );
  }
}
