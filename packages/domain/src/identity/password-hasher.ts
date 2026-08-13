/** Staff passwords below this length are rejected. No composition rules, no
 *  forced expiry — see design.md's "Staff — contraseña" table. */
export const MIN_PASSWORD_LENGTH = 12;

export class WeakPasswordError extends Error {
  constructor(minLength: number = MIN_PASSWORD_LENGTH) {
    super(`Password must be at least ${minLength} characters long.`);
    this.name = 'WeakPasswordError';
  }
}

/** Throws `WeakPasswordError` when `password` does not meet the minimum
 *  length. The single place both activation and reset route a new plaintext
 *  password through before it is ever hashed. */
export function assertValidPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError();
  }
}

/**
 * Hashes and verifies staff passwords. The concrete algorithm (argon2id,
 * OWASP-recommended parameters) is an infrastructure concern — this port is
 * the only way `domain`/`application` code touches password hashing, so the
 * library itself never crosses the hexagonal boundary (enforced by
 * dependency-cruiser's `domain-no-third-party-runtime-deps` rule).
 */
export interface PasswordHasher {
  /** Hashes a plaintext password for storage. Never returns the plaintext. */
  hash(password: string): Promise<string>;

  /** Verifies a plaintext password against a previously stored hash. */
  verify(hash: string, password: string): Promise<boolean>;

  /**
   * Pays the same computational cost as `verify()` without any real stored
   * hash to compare against — for when no matching user was found, so a
   * login attempt for a nonexistent email costs about the same as one for a
   * real user and cannot be used to enumerate which emails have accounts.
   * Always resolves to `false`: there is no real match to report.
   */
  verifyDummy(password: string): Promise<boolean>;
}
