import { Controller, ForbiddenException, Get, Inject, Param, Query } from '@nestjs/common';
import { GetOwnRevenueUseCase, GetOwnStatsUseCase } from '@jc-barberia/application';
import type { BarberRevenueResponse, BarberStatsResponse } from '@jc-barberia/contracts';
import type { ActorContext, Clock, TimeWindow } from '@jc-barberia/domain';

import { CurrentActor } from '../access-control/decorators/current-actor.decorator';
import { RequiresPermission } from '../access-control/decorators/requires-permission.decorator';
import { CLOCK } from './tokens';

/**
 * barber-profile spec, "Estadísticas de cortes propios" + "Facturación
 * teórica por precio de lista". `:barberId` is explicit in the path — the
 * same shape `AgendaRepository`'s `findScheduleFor(requestedBarberId,
 * actor)` already established (access-control, Phase 3b), reused here per
 * design: in production the barber-profile page always sends its own
 * `actor.barberId`, but a mismatched id (task 11.9's "la de otro barbero")
 * is rejected by the use case/repository before any query runs — never a
 * post-fetch filter. There is no "shop total" mode this handler
 * understands at all: `finance:read:own`/`agenda:read:own` are the only
 * permissions that reach it, and `role_permissions` never grants either to
 * owner/secretary (they hold `finance:read:shop`/`agenda:read:any`
 * instead) — "la facturación total del local" is structurally unreachable
 * through this route, not merely refused at runtime.
 */
@Controller('barbers')
export class BarberPerformanceController {
  constructor(
    private readonly getOwnStats: GetOwnStatsUseCase,
    private readonly getOwnRevenue: GetOwnRevenueUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @RequiresPermission('agenda:read:own')
  @Get(':barberId/stats')
  async stats(
    @Param('barberId') barberId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentActor() actor: ActorContext,
  ): Promise<BarberStatsResponse> {
    const result = await this.getOwnStats.execute(barberId, this.toRange(from, to), actor);
    if (result.outcome === 'forbidden') {
      throw new ForbiddenException(`Actor is not entitled to barber "${barberId}"'s stats.`);
    }
    return {
      count: result.count,
      cancelledCount: result.cancelledCount,
      absentCount: result.absentCount,
      unresolvedCount: result.unresolvedCount,
    };
  }

  @RequiresPermission('finance:read:own')
  @Get(':barberId/revenue')
  async revenue(
    @Param('barberId') barberId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentActor() actor: ActorContext,
  ): Promise<BarberRevenueResponse> {
    const result = await this.getOwnRevenue.execute(barberId, this.toRange(from, to), actor);
    if (result.outcome === 'forbidden') {
      throw new ForbiddenException(`Actor is not entitled to barber "${barberId}"'s revenue.`);
    }
    return {
      totalListPriceCents: result.totalListPriceCents,
      disclaimer: result.disclaimer,
      byService: result.byService,
    };
  }

  /** `from`/`to` are calendar dates (`YYYY-MM-DD`), never a raw instant —
   *  the ONLY place a `Date` is derived from this request, and it goes
   *  through `Clock`, never `new Date(...)`. Day, month or any custom
   *  period are all just different `from`/`to` values; there is no separate
   *  "month mode" to maintain. */
  private toRange(from: string, to: string): TimeWindow {
    return { start: this.clock.businessDayBounds(from).start, end: this.clock.businessDayBounds(to).end };
  }
}
