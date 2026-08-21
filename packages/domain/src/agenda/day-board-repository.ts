import type { ActorContext } from '../access-control';

export interface DayBoardSlotRecord {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  /** Joined from `services.name` — every slot has a real service, so this
   *  is never null. */
  readonly serviceName: string;
  readonly clientId: string | null;
  /** Joined from `clients`, `null` only when `clientId` itself is `null`
   *  (no client linked to this row yet). */
  readonly clientName: string | null;
  readonly clientAge: number | null;
  readonly clientPhone: string | null;
  /** Raw `slot_occupancies.status` — see `DayBoardRepository`'s own doc
   *  comment on why this stays a string here. */
  readonly status: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface DayBoardColumnRecord {
  readonly barberId: string;
  readonly barberName: string;
}

export interface DayBoardQueryResult {
  readonly columns: readonly DayBoardColumnRecord[];
  readonly slots: readonly DayBoardSlotRecord[];
}

/**
 * The day board's real data source (Phase 8): the barbers (columns) and
 * their `slot_occupancies` rows (slots) for one calendar date. Deliberately
 * separate from `AgendaRepository` (access-control's `findScheduleFor`,
 * which reads recurring weekly working hours, not appointments) — that port
 * has no production consumer yet; this is the day board's first real one
 * (admin-operations spec, "Vista del día por columnas de barbero").
 *
 * Implementations MUST narrow the query itself to `actor.barberId` when
 * `actor.role` is `'barber'` — the same rule `AgendaRepository` documents
 * (access-control spec, "El barbero queda acotado a sus propios datos"),
 * reused here per task 8.7: the `WHERE barber_id` binds inside the query,
 * never as a filter over an already-fetched, unscoped result set. Unlike
 * `AgendaRepository`, there is no separate "requested id" parameter to
 * compare against — a barber's own id IS the whole scope, so there is no id
 * to guess wrong and therefore no `forbidden` outcome to represent here; the
 * guard layer (`PermissionsGuard`, `agenda:read:any`/`agenda:read:own`)
 * already decided the actor may call this at all.
 *
 * `held`/`liberado` rows are excluded: design.md calls both "anteriores al
 * ciclo de vida del turno" — a hold mid-checkout is not yet a turno the day
 * board's viewers need to act on.
 */
export interface DayBoardRepository {
  findDayBoard(calendarDate: string, actor: ActorContext): Promise<DayBoardQueryResult>;
}
