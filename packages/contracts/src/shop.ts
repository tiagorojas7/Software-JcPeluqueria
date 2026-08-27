/**
 * Wire contract for `GET /shop/revenue` — docs/HUECOS-BACKEND.md #5,
 * "«Facturación del local» no existe". Same `from`/`to` calendar-date query
 * shape `barbers.ts`'s own stats/revenue endpoints already use: no raw ISO
 * instant crosses the wire, the server resolves the period through `Clock`.
 */

export interface ShopRevenueByBarberResponse {
  readonly barberId: string;
  readonly barberName: string;
  readonly count: number;
  readonly totalListPriceCents: number;
}

export interface ShopRevenueByServiceResponse {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly count: number;
  readonly totalListPriceCents: number;
}

export interface ShopRevenueResponse {
  readonly totalListPriceCents: number;
  readonly count: number;
  /** The EXACT SAME disclaimer `BarberRevenueResponse.disclaimer` carries —
   *  README's warning that an ambiguous figure generates arguments applies
   *  at the shop level too. */
  readonly disclaimer: string;
  readonly byBarber: readonly ShopRevenueByBarberResponse[];
  readonly byService: readonly ShopRevenueByServiceResponse[];
}
