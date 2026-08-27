import {
  dayOfWeekOf,
  type ActorContext,
  type Clock,
  type DayBoardQueryResult,
  type DayBoardRepository,
  type OccupancyChannel,
} from '@jc-barberia/domain';
import { and, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { barberSchedules, barbers, services } from '../db/schema/availability';
import { clients } from '../db/schema/clients';
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

    const inWindow = and(
      notInArray(slotOccupancies.status, [...EXCLUDED_STATUSES]),
      sql`${slotOccupancies.timeRange} && ${rangeLiteral}::tstzrange`,
    );
    // Los slots se resuelven PRIMERO porque las columnas dependen de ellos:
    // ver `columnsFor`.
    const rawSlots =
      actor.barberId !== undefined
        ? await this.selectSlots().where(and(inWindow, eq(slotOccupancies.barberId, actor.barberId)))
        : await this.selectSlots().where(inWindow);
    // `channel` is a plain `varchar` column — Drizzle infers `string`, not the
    // domain's closed `OccupancyChannel` union. Every write path only ever
    // stores one of its three values, so this cast states a fact the schema
    // itself cannot express, the same way every other reader of this column
    // in this codebase already does (`appointment.repository.ts`,
    // `hold.repository.ts`).
    const slots = rawSlots.map((slot) => ({ ...slot, channel: slot.channel as OccupancyChannel }));

    const columns = await this.columnsFor(actor, slots, calendarDate);

    return { columns, slots };
  }

  /**
   * Un barbero merece columna si sigue activo, o si —aun dado de baja— tiene
   * algo agendado ese dia.
   *
   * Filtrar solo por `active` parecia lo obvio y escondia trabajo real: dar
   * de baja a alguien que renuncio no borra los turnos que ya tenia tomados,
   * y el local necesita verlos para resolverlos. Al reves, mostrar a todos
   * los inactivos para siempre hacia que la baja no significara nada en
   * pantalla — que es lo que reporto el dueño.
   *
   * Los ids salen de los slots ya resueltos, asi que la ventana del dia y el
   * recorte por `actor.barberId` que esa consulta ya aplico se heredan
   * gratis: un barbero nunca puede ganar la columna de un colega por esta
   * via.
   */
  private async columnsFor(actor: ActorContext, slots: readonly { barberId: string }[], calendarDate: string) {
    const dayOfWeek = dayOfWeekOf(calendarDate);

    if (actor.barberId !== undefined) {
      return this.selectColumns(dayOfWeek).where(eq(barbers.id, actor.barberId));
    }

    const withSlots = [...new Set(slots.map((slot) => slot.barberId))];
    const visible =
      withSlots.length > 0
        ? or(eq(barbers.active, true), inArray(barbers.id, withSlots))
        : eq(barbers.active, true);

    return this.selectColumns(dayOfWeek).where(visible);
  }

  /**
   * The schedule is a LEFT join, and the day of week is part of the join
   * condition rather than a `WHERE`: a barber who does not work the requested
   * day must still get a COLUMN — with `null` hours — never disappear from
   * the board. Moving that predicate into the `WHERE` would silently drop
   * exactly the barbers whose absence the panel needs to show.
   *
   * `(barber_id, day_of_week)` is UNIQUE (see the schema), so this join can
   * never multiply a barber's row.
   *
   * `opens_at`/`closes_at` are `time` columns; Postgres renders them as
   * `HH:mm:ss` and the contract speaks `HH:mm`, so they are trimmed here —
   * the same shop-local wall-clock vocabulary `BarberSchedule` already uses.
   */
  private selectColumns(dayOfWeek: number) {
    return this.db
      .select({
        barberId: barbers.id,
        barberName: barbers.name,
        opensAt: sql<string | null>`substring(${barberSchedules.opensAt}::text from 1 for 5)`,
        closesAt: sql<string | null>`substring(${barberSchedules.closesAt}::text from 1 for 5)`,
      })
      .from(barbers)
      .leftJoin(
        barberSchedules,
        and(eq(barberSchedules.barberId, barbers.id), eq(barberSchedules.dayOfWeek, dayOfWeek)),
      );
  }

  private selectSlots() {
    // `.mapWith` borrows the `holdExpiresAt` timestamptz column's decoder —
    // same technique as DrizzleHoldRepository.freeRanges — so `startsAt`/
    // `endsAt` come back as real `Date`s, not raw strings.
    //
    // `services` is an inner join — every `slot_occupancies` row has a
    // `NOT NULL` `service_id` FK, so this can never drop a row. `clients` is
    // a LEFT join: `client_id` is nullable (a turno not yet linked to a
    // client), and this is exactly the "cuando esté cargada" case
    // admin-operations documents — a real `NULL`, not a placeholder.
    return this.db
      .select({
        id: slotOccupancies.id,
        barberId: slotOccupancies.barberId,
        serviceId: slotOccupancies.serviceId,
        serviceName: services.name,
        clientId: slotOccupancies.clientId,
        clientName: clients.name,
        clientAge: clients.age,
        clientPhone: clients.phone,
        status: slotOccupancies.status,
        channel: slotOccupancies.channel,
        startsAt: sql`lower(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
        endsAt: sql`upper(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
      })
      .from(slotOccupancies)
      .innerJoin(services, eq(slotOccupancies.serviceId, services.id))
      .leftJoin(clients, eq(slotOccupancies.clientId, clients.id));
  }
}
