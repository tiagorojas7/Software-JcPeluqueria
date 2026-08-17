import { Module } from '@nestjs/common';
import { GetPublicAvailabilityUseCase } from '@jc-barberia/application';
import {
  db,
  DrizzleBarberRepository,
  DrizzleFreeRangesQuery,
  DrizzleScheduleRepository,
  DrizzleServiceRepository,
  ShopClock,
} from '@jc-barberia/infrastructure';
import type { BarberRepository, Clock, FreeRangesQuery, ScheduleRepository, ServiceRepository } from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { AvailabilityController } from './availability.controller';
import { BARBER_REPOSITORY, CLOCK, FREE_RANGES_QUERY, SCHEDULE_REPOSITORY, SERVICE_REPOSITORY } from './tokens';

/**
 * Wires task 9.1/9.2's public availability endpoint. `AccessControlModule` is
 * still imported — `PermissionsGuard` is global (deny-by-default applies to
 * every controller, `@Public()` included: the guard has to run and see the
 * decorator to let the request through, it does not simply skip undecorated
 * modules).
 */
@Module({
  imports: [AccessControlModule],
  controllers: [AvailabilityController],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    { provide: BARBER_REPOSITORY, useFactory: () => new DrizzleBarberRepository(db) },
    { provide: SERVICE_REPOSITORY, useFactory: () => new DrizzleServiceRepository(db) },
    { provide: SCHEDULE_REPOSITORY, useFactory: () => new DrizzleScheduleRepository(db) },
    { provide: FREE_RANGES_QUERY, useFactory: () => new DrizzleFreeRangesQuery(db) },
    {
      provide: GetPublicAvailabilityUseCase,
      inject: [BARBER_REPOSITORY, SERVICE_REPOSITORY, SCHEDULE_REPOSITORY, FREE_RANGES_QUERY, CLOCK],
      useFactory: (
        barbers: BarberRepository,
        services: ServiceRepository,
        schedules: ScheduleRepository,
        freeRangesQuery: FreeRangesQuery,
        clock: Clock,
      ) => new GetPublicAvailabilityUseCase(barbers, services, schedules, freeRangesQuery, clock),
    },
  ],
})
export class BookingModule {}
