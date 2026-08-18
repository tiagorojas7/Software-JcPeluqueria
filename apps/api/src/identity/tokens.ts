/** DI token for the `PasswordHasher` port (see `PasswordService`'s
 *  constructor) — a plain interface has no runtime representation, same
 *  reason every other port in this app gets a Symbol token. */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

/** DI token for the `UserCredentialsRepository` port. */
export const USER_CREDENTIALS_REPOSITORY = Symbol('USER_CREDENTIALS_REPOSITORY');

/** DI token for the `SessionRepository` port. */
export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

export const CLOCK = Symbol('CLOCK');

/** DI token for the `ClientRepository` port (C.1: `RequestClientAccessUseCase`
 *  looks a client up by phone). Its own token instance, not reused from
 *  `BookingModule` — the one-token-per-module pattern every module in this
 *  app already follows. */
export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');

/** DI token for the `ClientAccountRepository` port (C.1: the passwordless
 *  account a challenge attaches to). */
export const CLIENT_ACCOUNT_REPOSITORY = Symbol('CLIENT_ACCOUNT_REPOSITORY');

/** DI token for the `AuthChallengeRepository` port (`ChallengeService`'s own
 *  dependency, C.1/C.2). */
export const AUTH_CHALLENGE_REPOSITORY = Symbol('AUTH_CHALLENGE_REPOSITORY');

/** DI token for the `NotificationOutboxRepository` port (C.1: where the
 *  access code/link is enqueued). Bound to the interim
 *  `ConsoleNotificationOutboxRepository` until Slice A's Drizzle adapter
 *  lands — see that class's own doc comment. */
export const NOTIFICATION_OUTBOX_REPOSITORY = Symbol('NOTIFICATION_OUTBOX_REPOSITORY');
