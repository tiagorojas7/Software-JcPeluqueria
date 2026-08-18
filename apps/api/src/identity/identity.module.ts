import { Module } from '@nestjs/common';
import {
  ChallengeService,
  ClientLoginUseCase,
  PasswordService,
  RequestClientAccessUseCase,
  SessionService,
  StaffLoginUseCase,
} from '@jc-barberia/application';
import {
  Argon2PasswordHasher,
  ConsoleNotificationOutboxRepository,
  db,
  DrizzleAuthChallengeRepository,
  DrizzleClientAccountRepository,
  DrizzleClientRepository,
  DrizzleSessionRepository,
  DrizzleUserCredentialsRepository,
  ShopClock,
} from '@jc-barberia/infrastructure';
import type {
  AuthChallengeRepository,
  Clock,
  ClientAccountRepository,
  ClientRepository,
  NotificationOutboxRepository,
  PasswordHasher,
  SessionRepository,
  UserCredentialsRepository,
} from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { AuthController } from './auth.controller';
import {
  AUTH_CHALLENGE_REPOSITORY,
  CLIENT_ACCOUNT_REPOSITORY,
  CLIENT_REPOSITORY,
  CLOCK,
  NOTIFICATION_OUTBOX_REPOSITORY,
  PASSWORD_HASHER,
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
 * `NOTIFICATION_OUTBOX_REPOSITORY` is bound to the interim
 * `ConsoleNotificationOutboxRepository` — Slice A's real
 * `DrizzleNotificationOutboxRepository` (migration 0011) does not exist on
 * this branch yet, and cablear-el-mvp explicitly says not to wait for it
 * (see that class's own doc comment). Swapping in the Drizzle adapter once
 * it lands is a one-line change here, nothing else in this module.
 */
@Module({
  imports: [AccessControlModule],
  controllers: [AuthController],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    { provide: PASSWORD_HASHER, useFactory: () => new Argon2PasswordHasher() },
    { provide: USER_CREDENTIALS_REPOSITORY, useFactory: () => new DrizzleUserCredentialsRepository(db) },
    { provide: SESSION_REPOSITORY, useFactory: () => new DrizzleSessionRepository(db) },
    { provide: CLIENT_REPOSITORY, useFactory: () => new DrizzleClientRepository(db) },
    { provide: CLIENT_ACCOUNT_REPOSITORY, useFactory: () => new DrizzleClientAccountRepository(db) },
    { provide: AUTH_CHALLENGE_REPOSITORY, useFactory: () => new DrizzleAuthChallengeRepository(db) },
    {
      provide: NOTIFICATION_OUTBOX_REPOSITORY,
      useFactory: () => new ConsoleNotificationOutboxRepository(),
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
      inject: [CLIENT_REPOSITORY, CLIENT_ACCOUNT_REPOSITORY, ChallengeService, NOTIFICATION_OUTBOX_REPOSITORY],
      useFactory: (
        clients: ClientRepository,
        accounts: ClientAccountRepository,
        challenges: ChallengeService,
        outbox: NotificationOutboxRepository,
      ) => new RequestClientAccessUseCase(clients, accounts, challenges, outbox),
    },
    {
      provide: ClientLoginUseCase,
      inject: [ChallengeService],
      useFactory: (challenges: ChallengeService) => new ClientLoginUseCase(challenges),
    },
  ],
})
export class IdentityModule {}
