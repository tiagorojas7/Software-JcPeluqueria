import { Controller, Get, Inject, Query } from '@nestjs/common';
import { GetShopRevenueUseCase } from '@jc-barberia/application';
import type { ShopRevenueResponse } from '@jc-barberia/contracts';
import type { Clock, TimeWindow } from '@jc-barberia/domain';

import { RequiresPermission } from '../access-control/decorators/requires-permission.decorator';
import { CLOCK } from './tokens';

/**
 * docs/HUECOS-BACKEND.md #5, "«Facturación del local» no existe" — the nav
 * item `visiblePanelNavItems` already shows for `finance:read:shop`
 * (migration `0006_access_control.sql` grants it to the owner alone) pointed
 * at nothing until now. `GetShopRevenueUseCase` never narrows to one barber
 * — that IS the difference from `BarberPerformanceController`, whose own doc
 * comment states the shop total is structurally unreachable through IT.
 */
@Controller('shop')
export class ShopRevenueController {
  constructor(
    private readonly getShopRevenue: GetShopRevenueUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @RequiresPermission('finance:read:shop')
  @Get('revenue')
  async revenue(@Query('from') from: string, @Query('to') to: string): Promise<ShopRevenueResponse> {
    const result = await this.getShopRevenue.execute(this.toRange(from, to));
    return {
      totalListPriceCents: result.totalListPriceCents,
      count: result.count,
      disclaimer: result.disclaimer,
      byBarber: result.byBarber,
      byService: result.byService,
    };
  }

  /** `from`/`to` are calendar dates (`YYYY-MM-DD`), never a raw instant —
   *  the ONLY place a `Date` is derived from this request, and it goes
   *  through `Clock`, never `new Date(...)`. Same idiom
   *  `BarberPerformanceController.toRange` already uses. */
  private toRange(from: string, to: string): TimeWindow {
    return { start: this.clock.businessDayBounds(from).start, end: this.clock.businessDayBounds(to).end };
  }
}
