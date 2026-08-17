import type { ActorContext } from '../access-control';
import type { TimeWindow } from '../availability';

/**
 * One `realizado` appointment, as far as the barber's own performance view
 * needs to know about it: which service it was (to price it) and by what id
 * (to count it). Deliberately carries `listPriceCents` rather than a bare
 * `serviceId` the caller would have to re-join — see
 * `BarberPerformanceRepository`'s own doc comment on why count and revenue
 * share this one query instead of each running their own.
 */
export interface CompletedAppointmentRecord {
  readonly appointmentId: string;
  readonly serviceId: string;
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
 * The single read both `GetOwnStatsUseCase` (count) and `GetOwnRevenueUseCase`
 * (sum of `listPriceCents`) are built on — one query, one narrowing rule,
 * two thin aggregations over its result. The rejected first attempt at this
 * phase gave each use case its own near-identical query/filter/price-map;
 * this port exists specifically so that duplication cannot recur.
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
}
