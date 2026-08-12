/**
 * The opaque server-side session record a session cookie's id points at —
 * never a JWT (see design.md's "Sesión — común a ambos": revocation must be
 * a single statement, not wait for token expiry).
 */
export interface Session {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

export interface SessionRepository {
  /** Persists a freshly minted session. `expiresAt` is the caller's
   *  responsibility — `SessionRepository` has no TTL policy of its own (see
   *  `SessionService` for the per-role TTL decision). */
  create(session: Session): Promise<void>;

  /**
   * Revokes every active session belonging to `userId` — the mechanism
   * behind "changing or resetting a password revokes all active sessions".
   * Must never touch another user's sessions.
   */
  revokeAllForUser(userId: string): Promise<void>;
}
