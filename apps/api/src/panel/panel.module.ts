import { Module } from '@nestjs/common';
import { ManageClientsAndBarbersUseCase } from '@jc-barberia/application';
import {
  db,
  DrizzleBarberRepository,
  DrizzleClientRepository,
  DrizzleScheduleRepository,
  DrizzleServiceRepository,
} from '@jc-barberia/infrastructure';
import type { BarberRepository, ClientRepository, ScheduleRepository, ServiceRepository } from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { ManageClientsAndBarbersController } from './manage-clients-and-barbers.controller';
import { BARBER_REPOSITORY, CLIENT_REPOSITORY, SCHEDULE_REPOSITORY, SERVICE_REPOSITORY } from './tokens';

/**
 * Wires task 10.14/10.15's panel endpoints. No pg-boss producer here — unlike
 * `BookingModule`/`AppointmentsModule`, nothing in this module enqueues a
 * job, so there is no `HOLD_EXPIRE_SCHEDULER`-style laziness concern and no
 * `OnApplicationShutdown` hook to add.
 */
@Module({
  imports: [AccessControlModule],
  controllers: [ManageClientsAndBarbersController],
  providers: [
    { provide: CLIENT_REPOSITORY, useFactory: () => new DrizzleClientRepository(db) },
    { provide: BARBER_REPOSITORY, useFactory: () => new DrizzleBarberRepository(db) },
    { provide: SCHEDULE_REPOSITORY, useFactory: () => new DrizzleScheduleRepository(db) },
    { provide: SERVICE_REPOSITORY, useFactory: () => new DrizzleServiceRepository(db) },
    {
      provide: ManageClientsAndBarbersUseCase,
      inject: [CLIENT_REPOSITORY, BARBER_REPOSITORY, SCHEDULE_REPOSITORY, SERVICE_REPOSITORY],
      useFactory: (
        clients: ClientRepository,
        barbers: BarberRepository,
        schedules: ScheduleRepository,
        services: ServiceRepository,
      ) => new ManageClientsAndBarbersUseCase(clients, barbers, schedules, services),
    },
  ],
})
export class PanelModule {}
