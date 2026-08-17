import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { CreateHold, CreatePhoneAppointmentUseCase } from '@jc-barberia/application';
import {
  db,
  DrizzleClientRepository,
  DrizzleHoldRepository,
  lazyJobSender,
  PgBossHoldExpireScheduler,
  ShopClock,
  stopJobSender,
} from '@jc-barberia/infrastructure';
import type { ClientRepository, Clock, HoldExpireScheduler, HoldRepository } from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { PhoneAppointmentController } from './phone-appointment.controller';
import { CLIENT_REPOSITORY, CLOCK, HOLD_EXPIRE_SCHEDULER, HOLD_REPOSITORY } from './tokens';

/** Wires task 10.1/10.2's real endpoint. `HoldRepository` is bound to its own
 *  token here rather than reused across modules — `AgendaModule` follows the
 *  same one-token-per-module pattern for `RolePermissionRepository`. */
@Module({
  imports: [AccessControlModule],
  controllers: [PhoneAppointmentController],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    { provide: CLIENT_REPOSITORY, useFactory: () => new DrizzleClientRepository(db) },
    { provide: HOLD_REPOSITORY, useFactory: () => new DrizzleHoldRepository(db) },
    {
      // Task 6.3's production half. `CreateHold` enqueues `hold.expire` on
      // every hold it creates, so the API is a pg-boss PRODUCER (the worker is
      // the consumer). Without this provider the module cannot be built at all.
      //
      // The factory is synchronous and `lazyJobSender()` defers the connection
      // to the first enqueue: building the module graph must not touch the
      // network, or the API stops booting whenever the queue's database is
      // down — and every Nest test dies before its first assertion.
      provide: HOLD_EXPIRE_SCHEDULER,
      useFactory: () => new PgBossHoldExpireScheduler(lazyJobSender()),
    },
    {
      provide: CreateHold,
      inject: [HOLD_REPOSITORY, CLOCK, HOLD_EXPIRE_SCHEDULER],
      useFactory: (holds: HoldRepository, clock: Clock, holdExpire: HoldExpireScheduler) =>
        new CreateHold(holds, clock, holdExpire),
    },
    {
      provide: CreatePhoneAppointmentUseCase,
      inject: [CLIENT_REPOSITORY, HOLD_REPOSITORY, CreateHold],
      useFactory: (clients: ClientRepository, holds: HoldRepository, createHold: CreateHold) =>
        new CreatePhoneAppointmentUseCase(clients, holds, createHold),
    },
  ],
})
export class AppointmentsModule implements OnApplicationShutdown {
  /** pg-boss keeps its own pool open; without this the process hangs on exit. */
  async onApplicationShutdown(): Promise<void> {
    await stopJobSender();
  }
}
