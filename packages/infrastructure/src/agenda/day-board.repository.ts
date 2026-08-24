import type { ActorContext, Clock, DayBoardQueryResult, DayBoardRepository } from '@jc-barberia/domain';
import { and, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { barbers, services } from '../db/schema/availability';
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
    const slots =
      actor.barberId !== undefined
        ? await this.selectSlots().where(and(inWindow, eq(slotOccupancies.barberId, actor.barberId)))
        : await this.selectSlots().where(inWindow);

    const columns = await this.columnsFor(actor, slots);

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
  private async columnsFor(actor: ActorContext, slots: readonly { barberId: string }[]) {
    if (actor.barberId !== undefined) {
      return this.selectColumns().where(eq(barbers.id, actor.barberId));
    }

    const withSlots = [...new Set(slots.map((slot) => slot.barberId))];
    const visible =
      withSlots.length > 0
        ? or(eq(barbers.active, true), inArray(barbers.id, withSlots))
        : eq(barbers.active, true);

    return this.selectColumns().where(visible);
  }

  private selectColumns() {
    return this.db.select({ barberId: barbers.id, barberName: barbers.name }).from(barbers);
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
        startsAt: sql`lower(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
        endsAt: sql`upper(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
      })
      .from(slotOccupancies)
      .innerJoin(services, eq(slotOccupancies.serviceId, services.id))
      .leftJoin(clients, eq(slotOccupancies.clientId, clients.id));
  }
}
