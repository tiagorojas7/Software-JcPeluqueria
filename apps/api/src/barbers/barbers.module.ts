import { Module } from '@nestjs/common';
import { GetOwnRevenueUseCase, GetOwnStatsUseCase } from '@jc-barberia/application';
import { db, DrizzleBarberPerformanceRepository, ShopClock } from '@jc-barberia/infrastructure';
import type { BarberPerformanceRepository } from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { BarberPerformanceController } from './barber-performance.controller';
import { BARBER_PERFORMANCE_REPOSITORY, CLOCK } from './tokens';

/** Wires task 11.5-11.10's real endpoints: binds `BarberPerformanceRepository`
 *  to its Postgres-backed adapter and reuses `AccessControlModule`'s already
 *  bound guard/actor-context wiring — same one-token-per-module pattern
 *  `AgendaModule`/`AppointmentsModule` already follow. */
@Module({
  imports: [AccessControlModule],
  controllers: [BarberPerformanceController],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    {
      provide: BARBER_PERFORMANCE_REPOSITORY,
      useFactory: () => new DrizzleBarberPerformanceRepository(db),
    },
    {
      provide: GetOwnStatsUseCase,
      inject: [BARBER_PERFORMANCE_REPOSITORY],
      useFactory: (performance: BarberPerformanceRepository) => new GetOwnStatsUseCase(performance),
    },
    {
      provide: GetOwnRevenueUseCase,
      inject: [BARBER_PERFORMANCE_REPOSITORY],
      useFactory: (performance: BarberPerformanceRepository) => new GetOwnRevenueUseCase(performance),
    },
  ],
})
export class BarbersModule {}
