/** DI token for the `PasswordHasher` port (see `PasswordService`'s
 *  constructor) — a plain interface has no runtime representation, same
 *  reason every other port in this app gets a Symbol token. */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

/** DI token for the `UserCredentialsRepository` port. */
export const USER_CREDENTIALS_REPOSITORY = Symbol('USER_CREDENTIALS_REPOSITORY');

/** DI token for the `SessionRepository` port. */
export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

export const CLOCK = Symbol('CLOCK');

/** DI token for the `ClientAccountRepository` port (C.1: the passwordless
 *  account a challenge attaches to; cuenta-cliente-persistente:
 *  `RequestClientAccessUseCase` now looks the account up directly by email
 *  through this same port, so `ClientRepository`/`CLIENT_REPOSITORY` is no
 *  longer a dependency of this module at all). */
export const CLIENT_ACCOUNT_REPOSITORY = Symbol('CLIENT_ACCOUNT_REPOSITORY');

/** DI token for the `AuthChallengeRepository` port (`ChallengeService`'s own
 *  dependency, C.1/C.2). */
export const AUTH_CHALLENGE_REPOSITORY = Symbol('AUTH_CHALLENGE_REPOSITORY');

/** DI token for the `NotificationOutboxRepository` port (C.1: where the
 *  access code/link is enqueued). Bound to Slice A's real
 *  `DrizzleNotificationOutboxRepository`, so the worker's dispatcher can
 *  actually deliver the code. */
export const NOTIFICATION_OUTBOX_REPOSITORY = Symbol('NOTIFICATION_OUTBOX_REPOSITORY');

/** DI token for the `AppointmentRepository` port (C.3/C.4: "Mi cuenta" reads
 *  the client's own appointments; self-cancel writes back to the same
 *  table). Its own token instance, not reused from any other module — the
 *  one-token-per-module pattern every module in this app already follows. */
export const APPOINTMENT_REPOSITORY = Symbol('APPOINTMENT_REPOSITORY');

/** DI token for the `PaymentPort` port (C.4: `SelfCancelAppointmentUseCase`
 *  refunds a settled seña as part of cancelling). */
export const PAYMENT_PORT = Symbol('PAYMENT_PORT');
