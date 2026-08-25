import { Module } from '@nestjs/common';
import { ChallengeService, ManageBarberAccountsUseCase, ManageClientsAndBarbersUseCase } from '@jc-barberia/application';
import {
  db,
  DrizzleAuthChallengeRepository,
  DrizzleBarberRepository,
  DrizzleClientRepository,
  DrizzleNotificationOutboxRepository,
  DrizzleScheduleRepository,
  DrizzleServiceRepository,
  DrizzleStaffAccountRepository,
  ShopClock,
} from '@jc-barberia/infrastructure';
import type {
  AuthChallengeRepository,
  BarberRepository,
  ClientRepository,
  Clock,
  NotificationOutboxRepository,
  ScheduleRepository,
  ServiceRepository,
  StaffAccountRepository,
} from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { BarberAccountsController } from './barber-accounts.controller';
import { ManageClientsAndBarbersController } from './manage-clients-and-barbers.controller';
import {
  AUTH_CHALLENGE_REPOSITORY,
  BARBER_REPOSITORY,
  CLIENT_REPOSITORY,
  CLOCK,
  NOTIFICATION_OUTBOX_REPOSITORY,
  SCHEDULE_REPOSITORY,
  SERVICE_REPOSITORY,
  STAFF_ACCOUNT_REPOSITORY,
} from './tokens';

/**
 * Wires task 10.14/10.15's panel endpoints. No pg-boss producer here — unlike
 * `BookingModule`/`AppointmentsModule`, nothing in this module enqueues a
 * job, so there is no `HOLD_EXPIRE_SCHEDULER`-style laziness concern and no
 * `OnApplicationShutdown` hook to add.
 *
 * It DOES enqueue a notification now: the barber's activation invite goes
 * through `NOTIFICATION_OUTBOX_REPOSITORY`, the same real Drizzle outbox
 * `IdentityModule` binds, so the worker's dispatcher delivers it exactly
 * like a client's access code. `ChallengeService` is constructed here rather
 * than imported from `IdentityModule` for the same one-instance-per-module
 * reason every repository above follows — it is a stateless composition of
 * two ports, not shared state.
 */
@Module({
  imports: [AccessControlModule],
  controllers: [ManageClientsAndBarbersController, BarberAccountsController],
  providers: [
    { provide: CLIENT_REPOSITORY, useFactory: () => new DrizzleClientRepository(db) },
    { provide: BARBER_REPOSITORY, useFactory: () => new DrizzleBarberRepository(db) },
    { provide: SCHEDULE_REPOSITORY, useFactory: () => new DrizzleScheduleRepository(db) },
    { provide: SERVICE_REPOSITORY, useFactory: () => new DrizzleServiceRepository(db) },
    { provide: STAFF_ACCOUNT_REPOSITORY, useFactory: () => new DrizzleStaffAccountRepository(db) },
    { provide: AUTH_CHALLENGE_REPOSITORY, useFactory: () => new DrizzleAuthChallengeRepository(db) },
    { provide: NOTIFICATION_OUTBOX_REPOSITORY, useFactory: () => new DrizzleNotificationOutboxRepository(db) },
    { provide: CLOCK, useFactory: () => new ShopClock() },
    {
      provide: ChallengeService,
      inject: [AUTH_CHALLENGE_REPOSITORY, CLOCK],
      useFactory: (challenges: AuthChallengeRepository, clock: Clock) => new ChallengeService(challenges, clock),
    },
    {
      provide: ManageBarberAccountsUseCase,
      inject: [STAFF_ACCOUNT_REPOSITORY, BARBER_REPOSITORY, ChallengeService, NOTIFICATION_OUTBOX_REPOSITORY],
      useFactory: (
        accounts: StaffAccountRepository,
        barbers: BarberRepository,
        challenges: ChallengeService,
        outbox: NotificationOutboxRepository,
      ) => new ManageBarberAccountsUseCase(accounts, barbers, challenges, outbox),
    },
    {
      provide: ManageClientsAndBarbersUseCase,
      inject: [
        CLIENT_REPOSITORY,
        BARBER_REPOSITORY,
        SCHEDULE_REPOSITORY,
        SERVICE_REPOSITORY,
        ManageBarberAccountsUseCase,
      ],
      useFactory: (
        clients: ClientRepository,
        barbers: BarberRepository,
        schedules: ScheduleRepository,
        services: ServiceRepository,
        accounts: ManageBarberAccountsUseCase,
      ) => new ManageClientsAndBarbersUseCase(clients, barbers, schedules, services, accounts),
    },
  ],
})
export class PanelModule {}
