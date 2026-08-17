import { Module } from '@nestjs/common';
import { CreateHold, CreatePhoneAppointmentUseCase } from '@jc-barberia/application';
import { db, DrizzleClientRepository, DrizzleHoldRepository, ShopClock } from '@jc-barberia/infrastructure';
import type { ClientRepository, Clock, HoldRepository } from '@jc-barberia/domain';

import { AdminMarkCompletedUseCase, CreateWalkInUseCase } from '@jc-barberia/application';
import { AccessControlModule } from '../access-control/access-control.module';
import { PhoneAppointmentController } from './phone-appointment.controller';
import { MarkCompletedController } from './mark-completed.controller';
import { ConfirmAbsenceController } from './confirm-absence.controller';
import { WalkInController } from './walk-in.controller';
import { CLIENT_REPOSITORY, CLOCK, HOLD_REPOSITORY, MARK_COMPLETED_REPOSITORY, CONFIRM_ABSENCE_HOLD_REPOSITORY, WALK_IN_REPOSITORY } from './tokens';

/** Wires task 10.1/10.2's real endpoint, task 10.16's mark-completed endpoint,
 *  task 10.17's confirm-absence endpoint and task 10.18's walk-in endpoint. */
@Module({
  imports: [AccessControlModule],
  controllers: [
    PhoneAppointmentController,
    MarkCompletedController,
    ConfirmAbsenceController,
    WalkInController,
  ],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    { provide: CLIENT_REPOSITORY, useFactory: () => new DrizzleClientRepository(db) },
    { provide: HOLD_REPOSITORY, useFactory: () => new DrizzleHoldRepository(db) },
    {
      provide: MARK_COMPLETED_REPOSITORY,
      useFactory: () => new AdminMarkCompletedUseCase(),
    },
    {
      provide: CONFIRM_ABSENCE_HOLD_REPOSITORY,
      useFactory: () => new DrizzleHoldRepository(db),
    },
    {
      provide: WALK_IN_REPOSITORY,
      useFactory: () => new CreateWalkInUseCase(),
    },
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