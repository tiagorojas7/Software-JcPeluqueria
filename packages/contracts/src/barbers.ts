/**
 * Wire contracts for barber-profile's own stats/revenue endpoints (Phase
 * 11). Both take the same `from`/`to` query shape — calendar dates, never a
 * raw ISO instant, so no `Date` is ever constructed on either side of the
 * wire; the server resolves the period bounds through `Clock`.
 */

export interface BarberStatsResponse {
  readonly count: number;
  /** docs/HUECOS-BACKEND.md #4 — how the OTHER turnos in the period resolved.
   *  A bare `realizado` count carries no context; five `ausentes` this month
   *  explains a low one. */
  readonly cancelledCount: number;
  readonly absentCount: number;
  readonly unresolvedCount: number;
}

export interface RevenueByServiceResponse {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly count: number;
  readonly totalListPriceCents: number;
}

export interface BarberRevenueResponse {
  readonly totalListPriceCents: number;
  /** The literal, user-facing Spanish disclaimer — barber-profile spec,
   *  "Facturación teórica por precio de lista". Rendered verbatim by the
   *  frontend, never re-authored client-side, so there is exactly one
   *  source of truth for this legally/financially sensitive wording. */
  readonly disclaimer: string;
  /** docs/HUECOS-BACKEND.md #3 — the same total, opened up by service. The
   *  average ticket per service is deliberately absent: it is exactly
   *  `totalListPriceCents / count`, and sending it as a THIRD number would
   *  let it drift from the two the frontend already has. */
  readonly byService: readonly RevenueByServiceResponse[];
}
