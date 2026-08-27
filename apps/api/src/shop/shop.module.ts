import { Module } from '@nestjs/common';
import { GetShopRevenueUseCase } from '@jc-barberia/application';
import { db, DrizzleShopRevenueRepository, ShopClock } from '@jc-barberia/infrastructure';
import type { ShopRevenueRepository } from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { ShopRevenueController } from './shop-revenue.controller';
import { CLOCK, SHOP_REVENUE_REPOSITORY } from './tokens';

/**
 * Wires docs/HUECOS-BACKEND.md #5's endpoint: binds `ShopRevenueRepository`
 * to its Postgres-backed adapter and reuses `AccessControlModule`'s already
 * bound guard/actor-context wiring — same one-token-per-module pattern
 * `BarbersModule`/`AgendaModule` already follow.
 */
@Module({
  imports: [AccessControlModule],
  controllers: [ShopRevenueController],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    { provide: SHOP_REVENUE_REPOSITORY, useFactory: () => new DrizzleShopRevenueRepository(db) },
    {
      provide: GetShopRevenueUseCase,
      inject: [SHOP_REVENUE_REPOSITORY],
      useFactory: (shopRevenue: ShopRevenueRepository) => new GetShopRevenueUseCase(shopRevenue),
    },
  ],
})
export class ShopModule {}
