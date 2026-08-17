import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { CreateHold, GetPublicAvailabilityUseCase } from '@jc-barberia/application';
import {
  db,
  DrizzleBarberRepository,
  DrizzleFreeRangesQuery,
  DrizzleHoldRepository,
  DrizzleScheduleRepository,
  DrizzleServiceRepository,
  jobSender,
  PgBossHoldExpireScheduler,
  ShopClock,
  stopJobSender,
} from '@jc-barberia/infrastructure';
import type {
  BarberRepository,
  Clock,
  FreeRangesQuery,
  HoldExpireScheduler,
  HoldRepository,
  ScheduleRepository,
  ServiceRepository,
} from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { AvailabilityController } from './availability.controller';
import { HoldController } from './hold.controller';
import {
  BARBER_REPOSITORY,
  CLOCK,
  FREE_RANGES_QUERY,
  HOLD_EXPIRE_SCHEDULER,
  HOLD_REPOSITORY,
  SCHEDULE_REPOSITORY,
  SERVICE_REPOSITORY,
} from './tokens';

/**
 * Wires task 9.1/9.2's public availability endpoint and task 9.3/9.4's
 * public hold endpoint. `AccessControlModule` is still imported —
 * `PermissionsGuard` is global (deny-by-default applies to every
 * controller, `@Public()` included: the guard has to run and see the
 * decorator to let the request through, it does not simply skip undecorated
 * modules). `HOLD_EXPIRE_SCHEDULER` follows the exact same pg-boss producer
 * pattern `AppointmentsModule` already established for `CreateHold`.
 */
@Module({
  imports: [AccessControlModule],
  controllers: [AvailabilityController, HoldController],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    { provide: BARBER_REPOSITORY, useFactory: () => new DrizzleBarberRepository(db) },
    { provide: SERVICE_REPOSITORY, useFactory: () => new DrizzleServiceRepository(db) },
    { provide: SCHEDULE_REPOSITORY, useFactory: () => new DrizzleScheduleRepository(db) },
    { provide: FREE_RANGES_QUERY, useFactory: () => new DrizzleFreeRangesQuery(db) },
    { provide: HOLD_REPOSITORY, useFactory: () => new DrizzleHoldRepository(db) },
    {
      provide: HOLD_EXPIRE_SCHEDULER,
      useFactory: async () => new PgBossHoldExpireScheduler(await jobSender()),
    },
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
    {
      provide: CreateHold,
      inject: [HOLD_REPOSITORY, CLOCK, HOLD_EXPIRE_SCHEDULER],
      useFactory: (holds: HoldRepository, clock: Clock, holdExpire: HoldExpireScheduler) =>
        new CreateHold(holds, clock, holdExpire),
    },
  ],
})
export class BookingModule implements OnApplicationShutdown {
  /** pg-boss keeps its own pool open; without this the process hangs on
   *  exit — same reason `AppointmentsModule` implements this too. */
  async onApplicationShutdown(): Promise<void> {
    await stopJobSender();
  }
}
