import type {
  ActorContext,
  BarberPerformanceAccessResult,
  BarberPerformanceRepository,
  TimeWindow,
} from '@jc-barberia/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { services } from '../db/schema/availability';
import { slotOccupancies } from '../db/schema/slot-occupancy';

/**
 * barber-profile spec, "Estadísticas de cortes propios" + "Facturación
 * teórica por precio de lista" — the single query `GetOwnStatsUseCase` and
 * `GetOwnRevenueUseCase` both consume through `BarberPerformanceRepository`
 * (see that port's own doc comment on why one query, not two near-duplicate
 * ones). `services.priceCents` is read fresh on every call, joined at query
 * time — "precio de lista" is the service's CURRENT price, never a frozen
 * booking-time amount.
 */
export class DrizzleBarberPerformanceRepository implements BarberPerformanceRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  /** Decides `forbidden` from identity alone (comparing `actor.barberId`
   *  against `requestedBarberId`) BEFORE ever touching the database — same
   *  rule as `DrizzleAgendaRepository`/`DrizzleDayBoardRepository`: the
   *  query below only ever runs bound to a single, already-authorized
   *  barber id, never "select every barber's realizado rows, then filter". */
  async findCompletedAppointments(
    requestedBarberId: string,
    range: TimeWindow,
    actor: ActorContext,
  ): Promise<BarberPerformanceAccessResult> {
    if (actor.barberId !== undefined && actor.barberId !== requestedBarberId) {
      return { outcome: 'forbidden' };
    }

    const rangeLiteral = `[${range.start.toISOString()},${range.end.toISOString()})`;
    const rows = await this.db
      .select({
        appointmentId: slotOccupancies.id,
        serviceId: slotOccupancies.serviceId,
        listPriceCents: services.priceCents,
      })
      .from(slotOccupancies)
      .innerJoin(services, eq(services.id, slotOccupancies.serviceId))
      .where(
        and(
          eq(slotOccupancies.barberId, requestedBarberId),
          // Only realizado counts as a "corte" — reservado/cancelado/ausente
          // must never inflate the barber's own stats or revenue.
          eq(slotOccupancies.status, 'realizado'),
          sql`${slotOccupancies.timeRange} && ${rangeLiteral}::tstzrange`,
        ),
      );

    return { outcome: 'allowed', appointments: rows };
  }
}
