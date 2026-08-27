import { Module } from '@nestjs/common';
import {
  ActivateStaffUseCase,
  ChallengeService,
  ClientLoginByEmailUseCase,
  ClientLoginUseCase,
  GetOwnProfileUseCase,
  ListOwnAppointmentsUseCase,
  PasswordService,
  RequestClientAccessUseCase,
  SelfCancelAppointmentUseCase,
  SessionService,
  StaffLoginUseCase,
} from '@jc-barberia/application';
import {
  Argon2PasswordHasher,
  db,
  DrizzleAppointmentRepository,
  DrizzleAuthChallengeRepository,
  DrizzleBarberRepository,
  DrizzleClientAccountRepository,
  DrizzleClientRepository,
  DrizzleNotificationOutboxRepository,
  DrizzleServiceRepository,
  DrizzleSessionRepository,
  DrizzleUserCredentialsRepository,
  MercadoPagoPaymentAdapter,
  ShopClock,
} from '@jc-barberia/infrastructure';
import type {
  AppointmentRepository,
  AuthChallengeRepository,
  BarberRepository,
  Clock,
  ClientAccountRepository,
  ClientRepository,
  NotificationOutboxRepository,
  PasswordHasher,
  PaymentPort,
  ServiceRepository,
  SessionRepository,
  UserCredentialsRepository,
} from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { AccountController } from './account.controller';
import { AuthController } from './auth.controller';
import {
  APPOINTMENT_REPOSITORY,
  AUTH_CHALLENGE_REPOSITORY,
  CLIENT_ACCOUNT_REPOSITORY,
  CLIENT_REPOSITORY,
  CLOCK,
  NOTIFICATION_OUTBOX_REPOSITORY,
  PASSWORD_HASHER,
  PAYMENT_PORT,
  SESSION_REPOSITORY,
  USER_CREDENTIALS_REPOSITORY,
} from './tokens';

/**
 * The staff-login entrypoint (see `AuthController`'s own doc comment for why
 * this module exists at all, and why it is not one of the 40 tracked
 * requirements) PLUS cablear-el-mvp Slice C's client-access entrypoints
 * (C.1/C.2). Imports `AccessControlModule` to reuse its already-bound
 * `ActorContextRepository`/`ClientContextRepository` — never a second
 * instance registered under a different token, same one-token-per-module
 * discipline every other feature module in this app follows.
 *
 * `NOTIFICATION_OUTBOX_REPOSITORY` is bound to Slice A's real
 * `DrizzleNotificationOutboxRepository` (migration 0011). The interim
 * console adapter it replaced was correct while Slice A had not landed on
 * this branch — but console-only meant the access code was printed to the
 * API log and never written to `notification_outbox`, so the worker's
 * dispatcher could not see it and `NOTIFICATION_CHANNEL=gmail` would still
 * never mail a client their code.
 */
/** Own tokens rather than the ones `absence-reassignment` declares: two
 *  modules sharing a provider symbol couples them for no reason. */
const IDENTITY_BARBER_REPOSITORY = Symbol('IDENTITY_BARBER_REPOSITORY');
const IDENTITY_SERVICE_REPOSITORY = Symbol('IDENTITY_SERVICE_REPOSITORY');

@Module({
  imports: [AccessControlModule],
  controllers: [AuthController, AccountController],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    { provide: PASSWORD_HASHER, useFactory: () => new Argon2PasswordHasher() },
    { provide: USER_CREDENTIALS_REPOSITORY, useFactory: () => new DrizzleUserCredentialsRepository(db) },
    { provide: SESSION_REPOSITORY, useFactory: () => new DrizzleSessionRepository(db) },
    { provide: CLIENT_ACCOUNT_REPOSITORY, useFactory: () => new DrizzleClientAccountRepository(db) },
    { provide: AUTH_CHALLENGE_REPOSITORY, useFactory: () => new DrizzleAuthChallengeRepository(db) },
    {
      provide: NOTIFICATION_OUTBOX_REPOSITORY,
      useFactory: () => new DrizzleNotificationOutboxRepository(db),
    },
    {
      // C.3/C.4: "Mi cuenta" reads/writes the exact same `slot_occupancies`
      // rows `AppointmentsModule`/`AgendaModule` do — its own token instance
      // here, never a shared one, per this app's one-token-per-module rule.
      provide: APPOINTMENT_REPOSITORY,
      useFactory: () => new DrizzleAppointmentRepository(db),
    },
    {
      // C.4: `SelfCancelAppointmentUseCase` refunds a settled seña as part of
      // cancelling — same adapter/env var `BookingModule.PAYMENT_PORT`
      // already binds, just this module's own token.
      provide: PAYMENT_PORT,
      useFactory: () => new MercadoPagoPaymentAdapter(process.env.MERCADOPAGO_ACCESS_TOKEN ?? ''),
    },
    {
      provide: PasswordService,
      inject: [PASSWORD_HASHER, USER_CREDENTIALS_REPOSITORY],
      useFactory: (hasher: PasswordHasher, credentials: UserCredentialsRepository) =>
        new PasswordService(hasher, credentials),
    },
    {
      provide: StaffLoginUseCase,
      inject: [PasswordService],
      useFactory: (passwords: PasswordService) => new StaffLoginUseCase(passwords),
    },
    {
      provide: SessionService,
      inject: [SESSION_REPOSITORY, CLOCK],
      useFactory: (sessions: SessionRepository, clock: Clock) => new SessionService(sessions, clock),
    },
    {
      provide: ChallengeService,
      inject: [AUTH_CHALLENGE_REPOSITORY, CLOCK],
      useFactory: (challenges: AuthChallengeRepository, clock: Clock) => new ChallengeService(challenges, clock),
    },
    {
      // The other end of the invite the panel sends
      // (`ManageBarberAccountsUseCase`): this is what consumes the
      // activation link. `PasswordService.setPassword` is the ONLY seam that
      // writes a staff password hash, and it is reached from HERE — from the
      // staff member choosing their own password, never from the owner's
      // side of the screen.
      provide: ActivateStaffUseCase,
      inject: [ChallengeService, PasswordService],
      useFactory: (challenges: ChallengeService, passwords: PasswordService) =>
        new ActivateStaffUseCase(challenges, passwords),
    },
    {
      provide: RequestClientAccessUseCase,
      inject: [CLIENT_ACCOUNT_REPOSITORY, ChallengeService, NOTIFICATION_OUTBOX_REPOSITORY],
      useFactory: (
        accounts: ClientAccountRepository,
        challenges: ChallengeService,
        outbox: NotificationOutboxRepository,
      ) => new RequestClientAccessUseCase(accounts, challenges, outbox),
    },
    {
      provide: ClientLoginUseCase,
      inject: [ChallengeService],
      useFactory: (challenges: ChallengeService) => new ClientLoginUseCase(challenges),
    },
    {
      // fix/acceso-cliente-sin-id: the email-keyed client-facing login path.
      // Depends on `ClientLoginUseCase` itself (already provided above) to
      // reuse its exact challengeId+secret consumption/mapping rather than
      // duplicating it.
      provide: ClientLoginByEmailUseCase,
      inject: [CLIENT_ACCOUNT_REPOSITORY, ChallengeService, ClientLoginUseCase],
      useFactory: (accounts: ClientAccountRepository, challenges: ChallengeService, clientLogin: ClientLoginUseCase) =>
        new ClientLoginByEmailUseCase(accounts, challenges, clientLogin),
    },
    {
      provide: IDENTITY_BARBER_REPOSITORY,
      useFactory: () => new DrizzleBarberRepository(db),
    },
    {
      provide: IDENTITY_SERVICE_REPOSITORY,
      useFactory: () => new DrizzleServiceRepository(db),
    },
    {
      // docs/HUECOS-BACKEND.md #7: the catalogues come in so the use case can
      // turn `barberId`/`serviceId` into the names "Mi cuenta" shows.
      provide: ListOwnAppointmentsUseCase,
      inject: [APPOINTMENT_REPOSITORY, IDENTITY_BARBER_REPOSITORY, IDENTITY_SERVICE_REPOSITORY],
      useFactory: (
        appointments: AppointmentRepository,
        barbers: BarberRepository,
        services: ServiceRepository,
      ) => new ListOwnAppointmentsUseCase(appointments, barbers, services),
    },
    {
      provide: SelfCancelAppointmentUseCase,
      inject: [APPOINTMENT_REPOSITORY, PAYMENT_PORT, CLOCK],
      useFactory: (appointments: AppointmentRepository, paymentPort: PaymentPort, clock: Clock) =>
        new SelfCancelAppointmentUseCase(appointments, paymentPort, clock),
    },
    {
      // panel-usable: "Mi cuenta"/booking-flow read back a returning
      // client's own stored details — its own token instance, same
      // one-token-per-module pattern every other repository above follows.
      provide: CLIENT_REPOSITORY,
      useFactory: () => new DrizzleClientRepository(db),
    },
    {
      provide: GetOwnProfileUseCase,
      inject: [CLIENT_REPOSITORY],
      useFactory: (clients: ClientRepository) => new GetOwnProfileUseCase(clients),
    },
  ],
})
export class IdentityModule {}
