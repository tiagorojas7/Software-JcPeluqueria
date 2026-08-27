import type { ActorContext } from '../access-control';
import type { TimeWindow } from '../availability';

/**
 * One `realizado` appointment, as far as the barber's own performance view
 * needs to know about it: which service it was (to price it and name it) and
 * by what id (to count it). Deliberately carries `listPriceCents`/`serviceName`
 * rather than a bare `serviceId` the caller would have to re-join — see
 * `BarberPerformanceRepository`'s own doc comment on why count and revenue
 * share this one query instead of each running their own.
 *
 * `serviceName` (docs/HUECOS-BACKEND.md #3, "La facturación del barbero no se
 * puede desglosar"): `GetOwnRevenueUseCase` groups appointments by
 * `serviceId` to build the per-service breakdown the barber's own screen
 * needs, and a group needs a label — re-deriving that label from a second,
 * separate service lookup would duplicate the exact join this port already
 * performs for the price.
 */
export interface CompletedAppointmentRecord {
  readonly appointmentId: string;
  readonly serviceId: string;
  readonly serviceName: string;
  /** The service's list price AT THE TIME OF THE QUERY (barber-profile spec,
   *  "Facturación teórica por precio de lista") — never a frozen
   *  booking-time amount, and never the deposit/payment amount, which is
   *  Phase 5's concern and only ever half of this figure. */
  readonly listPriceCents: number;
}

/**
 * Same shape as `AgendaAccessResult` (access-control's `AgendaRepository`)
 * and for the same reason: a barber asking about a colleague's completed
 * appointments is a *denied* request, not an *empty* one. Collapsing the two
 * would let a caller mistake "no cortes this period" for "not allowed to
 * ask" — a handler must turn the first into 200 with `count: 0` and the
 * second into 403.
 */
export type BarberPerformanceAccessResult =
  | { readonly outcome: 'forbidden' }
  | { readonly outcome: 'allowed'; readonly appointments: readonly CompletedAppointmentRecord[] };

/**
 * docs/HUECOS-BACKEND.md #4, "El barbero no puede ver cómo cerraron sus
 * turnos": today the barber sees a bare `realizado` count with no context —
 * five `ausente` this month explains a low number and is exactly the
 * information README's absence-tracking story depends on being visible.
 * Every count is scoped to `range` and `requestedBarberId`, same as
 * `findCompletedAppointments`; `realizado` is included here too so
 * `GetOwnStatsUseCase` can read every count off ONE query instead of two.
 */
export interface AppointmentStatusCounts {
  readonly realizado: number;
  readonly cancelado: number;
  readonly ausente: number;
  readonly sin_registrado: number;
}

export type BarberStatusCountsResult =
  | { readonly outcome: 'forbidden' }
  | { readonly outcome: 'allowed'; readonly counts: AppointmentStatusCounts };

/**
 * The single read both `GetOwnStatsUseCase` (count) and `GetOwnRevenueUseCase`
 * (sum of `listPriceCents`, and its own per-service breakdown) are built on —
 * one query, one narrowing rule, two thin aggregations over its result. The
 * rejected first attempt at this phase gave each use case its own
 * near-identical query/filter/price-map; this port exists specifically so
 * that duplication cannot recur.
 *
 * Implementations MUST narrow the query itself to `requestedBarberId` AND
 * `status = 'realizado'` AND `range` — the same rule
 * `AgendaRepository`/`DayBoardRepository` already document (access-control
 * spec, "El barbero queda acotado a sus propios datos"): `forbidden` is
 * decided from identity alone, comparing `actor.barberId` to
 * `requestedBarberId`, BEFORE the query ever runs — never "fetch a
 * colleague's completed appointments, then filter them out afterward".
 */
export interface BarberPerformanceRepository {
  findCompletedAppointments(
    requestedBarberId: string,
    range: TimeWindow,
    actor: ActorContext,
  ): Promise<BarberPerformanceAccessResult>;

  /**
   * The count of EVERY status this barber's turnos in `range` resolved to
   * (`realizado`/`cancelado`/`ausente`/`sin_registrado`) — never just the
   * `realizado` one `findCompletedAppointments` narrows to. Same
   * `requestedBarberId`/`actor` narrowing rule as `findCompletedAppointments`.
   */
  countByStatus(
    requestedBarberId: string,
    range: TimeWindow,
    actor: ActorContext,
  ): Promise<BarberStatusCountsResult>;
}
