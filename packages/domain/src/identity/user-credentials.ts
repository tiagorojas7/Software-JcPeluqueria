/** The slice of a `users` row that password verification/rotation needs —
 *  never the row's other identity fields (role, barber/client linkage). */
export interface UserCredentials {
  readonly id: string;
  /** `null` for clients — only staff ever authenticate with a password. */
  readonly passwordHash: string | null;
  readonly active: boolean;
}

export interface UserCredentialsRepository {
  /** `null` when no user has this email — callers must still pay the
   *  `PasswordHasher.verifyDummy` cost in that branch (see `PasswordService`). */
  findByEmail(email: string): Promise<UserCredentials | null>;

  /** Overwrites the stored hash. Only ever called with an already-hashed
   *  value — the plaintext password never reaches this port. */
  setPassword(userId: string, passwordHash: string): Promise<void>;
}
