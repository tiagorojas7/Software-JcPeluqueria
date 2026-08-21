import { Module } from '@nestjs/common';
import {
  ChallengeService,
  ClientLoginUseCase,
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
  DrizzleClientAccountRepository,
  DrizzleNotificationOutboxRepository,
  DrizzleSessionRepository,
  DrizzleUserCredentialsRepository,
  MercadoPagoPaymentAdapter,
  ShopClock,
} from '@jc-barberia/infrastructure';
import type {
  AppointmentRepository,
  AuthChallengeRepository,
  Clock,
  ClientAccountRepository,
  NotificationOutboxRepository,
  PasswordHasher,
  PaymentPort,
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
      provide: ListOwnAppointmentsUseCase,
      inject: [APPOINTMENT_REPOSITORY],
      useFactory: (appointments: AppointmentRepository) => new ListOwnAppointmentsUseCase(appointments),
    },
    {
      provide: SelfCancelAppointmentUseCase,
      inject: [APPOINTMENT_REPOSITORY, PAYMENT_PORT, CLOCK],
      useFactory: (appointments: AppointmentRepository, paymentPort: PaymentPort, clock: Clock) =>
        new SelfCancelAppointmentUseCase(appointments, paymentPort, clock),
    },
  ],
})
export class IdentityModule {}
