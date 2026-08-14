import { Module } from '@nestjs/common';
import { CreateHold, CreatePhoneAppointmentUseCase } from '@jc-barberia/application';
import { db, DrizzleClientRepository, DrizzleHoldRepository, ShopClock } from '@jc-barberia/infrastructure';
import type { ClientRepository, Clock, HoldRepository } from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { PhoneAppointmentController } from './phone-appointment.controller';
import { CLIENT_REPOSITORY, CLOCK, HOLD_REPOSITORY } from './tokens';

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
      provide: CreateHold,
      inject: [HOLD_REPOSITORY, CLOCK],
      useFactory: (holds: HoldRepository, clock: Clock) => new CreateHold(holds, clock),
    },
    {
      provide: CreatePhoneAppointmentUseCase,
      inject: [CLIENT_REPOSITORY, HOLD_REPOSITORY, CreateHold],
      useFactory: (clients: ClientRepository, holds: HoldRepository, createHold: CreateHold) =>
        new CreatePhoneAppointmentUseCase(clients, holds, createHold),
    },
  ],
})
export class AppointmentsModule {}
