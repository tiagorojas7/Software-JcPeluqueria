import type { ShopRevenueRepository, TimeWindow } from '@jc-barberia/domain';

import { REVENUE_DISCLAIMER } from '../barbers/get-own-revenue';

export interface ShopRevenueByBarber {
  readonly barberId: string;
  readonly barberName: string;
  readonly count: number;
  readonly totalListPriceCents: number;
}

export interface ShopRevenueByService {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly count: number;
  readonly totalListPriceCents: number;
}

export interface ShopRevenueResult {
  readonly totalListPriceCents: number;
  readonly count: number;
  /** The EXACT SAME wording `GetOwnRevenueUseCase` uses — README's warning
   *  that an ambiguous figure generates arguments applies just as much at
   *  the shop level, and reusing the constant is what keeps the two texts
   *  from ever drifting apart. */
  readonly disclaimer: string;
  readonly byBarber: readonly ShopRevenueByBarber[];
  readonly byService: readonly ShopRevenueByService[];
}

/**
 * docs/HUECOS-BACKEND.md #5, "«Facturación del local» no existe" — until now
 * there was no use case, no controller, no route: `finance:read:shop` is a
 * real permission the 3b seed grants the owner, and the nav item it unlocks
 * pointed at nothing. Unlike `GetOwnRevenueUseCase`, this NEVER narrows to
 * one barber — no actor parameter at all, matching every other panel use
 * case in this codebase: the HTTP boundary's
 * `@RequiresPermission('finance:read:shop')` is the one place that decides
 * who may call this, not this class re-deciding it.
 */
export class GetShopRevenueUseCase {
  constructor(private readonly shopRevenue: ShopRevenueRepository) {}

  async execute(range: TimeWindow): Promise<ShopRevenueResult> {
    const records = await this.shopRevenue.findCompletedAppointments(range);

    const totalListPriceCents = records.reduce((sum, item) => sum + item.listPriceCents, 0);

    const byBarberId = new Map<string, ShopRevenueByBarber>();
    const byServiceId = new Map<string, ShopRevenueByService>();
    for (const record of records) {
      const barber = byBarberId.get(record.barberId);
      byBarberId.set(record.barberId, {
        barberId: record.barberId,
        barberName: record.barberName,
        count: (barber?.count ?? 0) + 1,
        totalListPriceCents: (barber?.totalListPriceCents ?? 0) + record.listPriceCents,
      });

      const service = byServiceId.get(record.serviceId);
      byServiceId.set(record.serviceId, {
        serviceId: record.serviceId,
        serviceName: record.serviceName,
        count: (service?.count ?? 0) + 1,
        totalListPriceCents: (service?.totalListPriceCents ?? 0) + record.listPriceCents,
      });
    }

    return {
      totalListPriceCents,
      count: records.length,
      disclaimer: REVENUE_DISCLAIMER,
      byBarber: [...byBarberId.values()],
      byService: [...byServiceId.values()],
    };
  }
}
