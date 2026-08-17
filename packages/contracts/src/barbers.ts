/**
 * Wire contracts for barber-profile's own stats/revenue endpoints (Phase
 * 11). Both take the same `from`/`to` query shape — calendar dates, never a
 * raw ISO instant, so no `Date` is ever constructed on either side of the
 * wire; the server resolves the period bounds through `Clock`.
 */

export interface BarberStatsResponse {
  readonly count: number;
}

export interface BarberRevenueResponse {
  readonly totalListPriceCents: number;
  /** The literal, user-facing Spanish disclaimer — barber-profile spec,
   *  "Facturación teórica por precio de lista". Rendered verbatim by the
   *  frontend, never re-authored client-side, so there is exactly one
   *  source of truth for this legally/financially sensitive wording. */
  readonly disclaimer: string;
}
