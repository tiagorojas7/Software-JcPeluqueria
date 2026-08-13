import type {
  ActorContext,
  AgendaAccessResult,
  AgendaRepository,
  DayOfWeek,
} from '@jc-barberia/domain';
import { createBarberSchedule } from '@jc-barberia/domain';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { barberSchedules } from '../db/schema/availability';
import { toWallClockTime } from '../shared/db/wall-clock-time';

export class DrizzleAgendaRepository implements AgendaRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  /** Decides `forbidden` from identity alone (comparing `actor.barberId`
   *  against `requestedBarberId`) BEFORE ever touching the database — the
   *  query below only ever runs bound to a single, already-authorized
   *  barber id, never "select every barber's rows, then filter". See the
   *  port's own doc comment. */
  async findScheduleFor(requestedBarberId: string, actor: ActorContext): Promise<AgendaAccessResult> {
    if (actor.barberId !== undefined && actor.barberId !== requestedBarberId) {
      return { outcome: 'forbidden' };
    }
    const scopedBarberId = actor.barberId ?? requestedBarberId;

    const rows = await this.db
      .select()
      .from(barberSchedules)
      .where(eq(barberSchedules.barberId, scopedBarberId));

    return {
      outcome: 'allowed',
      schedule: rows.map((row) =>
        createBarberSchedule({
          barberId: row.barberId,
          dayOfWeek: row.dayOfWeek as DayOfWeek,
          opensAt: toWallClockTime(row.opensAt),
          closesAt: toWallClockTime(row.closesAt),
        }),
      ),
    };
  }
}
