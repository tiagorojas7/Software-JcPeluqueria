import { Module } from '@nestjs/common';
import { PasswordService, SessionService, StaffLoginUseCase } from '@jc-barberia/application';
import {
  Argon2PasswordHasher,
  db,
  DrizzleSessionRepository,
  DrizzleUserCredentialsRepository,
  ShopClock,
} from '@jc-barberia/infrastructure';
import type { Clock, PasswordHasher, SessionRepository, UserCredentialsRepository } from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { AuthController } from './auth.controller';
import { CLOCK, PASSWORD_HASHER, SESSION_REPOSITORY, USER_CREDENTIALS_REPOSITORY } from './tokens';

/**
 * The staff-login entrypoint (see `AuthController`'s own doc comment for why
 * this module exists at all, and why it is not one of the 40 tracked
 * requirements). Imports `AccessControlModule` to reuse its already-bound
 * `ActorContextRepository` — never a second instance registered under a
 * different token, same one-token-per-module discipline every other
 * feature module in this app follows.
 */
@Module({
  imports: [AccessControlModule],
  controllers: [AuthController],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    { provide: PASSWORD_HASHER, useFactory: () => new Argon2PasswordHasher() },
    { provide: USER_CREDENTIALS_REPOSITORY, useFactory: () => new DrizzleUserCredentialsRepository(db) },
    { provide: SESSION_REPOSITORY, useFactory: () => new DrizzleSessionRepository(db) },
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
  ],
})
export class IdentityModule {}
