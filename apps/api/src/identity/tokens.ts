/** DI token for the `PasswordHasher` port (see `PasswordService`'s
 *  constructor) — a plain interface has no runtime representation, same
 *  reason every other port in this app gets a Symbol token. */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

/** DI token for the `UserCredentialsRepository` port. */
export const USER_CREDENTIALS_REPOSITORY = Symbol('USER_CREDENTIALS_REPOSITORY');

/** DI token for the `SessionRepository` port. */
export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

export const CLOCK = Symbol('CLOCK');
