import { type AppointmentSweepRepository, type BusinessDayBounds } from '@jc-barberia/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { slotOccupancies } from '../db/schema/slot-occupancy';

/**
 * The persistent side of the day-end sweep. One atomic
 * `UPDATE ... WHERE status = 'reservado' AND lower(time_range) BETWEEN bounds`
 * — the range filter is two-sided (`start` AND `end`), so a future-day `reservado`
 * AND a previous-day one both fall outside the window and stay put
 * ("Turnos futuros no son afectados"; appointment-lifecycle spec).
 *
 * Only `status` moves; `deposit_id` (the seña) is never touched here — a web
 * `reservado` keeps its settled seña retained without changes ("permanecer
 * retenida sin cambios") and a phone `reservado` keeps its NULL — so con y sin
 * seña transition identically, exactly as the spec mandates. The absence step
 * (`sin_registrado` -> `ausente`, which forfeits the seña) stays a separate
 * human-confirmed action (`ConfirmAbsenceUseCase`), never this job.
 *
 * `transitionUnmarked` returns the number of rows it actually flipped this
 * call — an audit signal for the cron handler, not money. Zero is a legit
 * "nothing to sweep / already swept" outcome.
 */
export class DrizzleAppointmentSweepRepository implements AppointmentSweepRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async transitionUnmarked(bounds: BusinessDayBounds): Promise<number> {
    const rows = await this.db
      .update(slotOccupancies)
      .set({ status: 'sin_registrado' })
      .where(
        and(
          eq(slotOccupancies.status, 'reservado'),
          sql`lower(${slotOccupancies.timeRange}) >= ${bounds.start.toISOString()}::timestamptz`,
          sql`lower(${slotOccupancies.timeRange}) <= ${bounds.end.toISOString()}::timestamptz`,
        ),
      )
      .returning({ id: slotOccupancies.id });
    return rows.length;
  }
}
