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

/**
 * Who a session belongs to, for TTL purposes only. Deliberately NOT derived
 * from the `roles`/`role_permissions` tables Phase 3b introduces: this
 * phase cannot depend on 3b (the dependency graph runs the other way — 3b
 * depends on 3a), so whoever already knows which login just succeeded
 * (`ClientLoginUseCase`, `StaffLoginUseCase`, or a future owner-specific
 * check) passes it directly, rather than `SessionService` resolving it
 * through a role lookup that doesn't exist yet.
 */
export type SessionSubjectKind = 'client' | 'staff' | 'owner';

/**
 * `SessionService.create()`'s only source of truth for how long a session
 * lives. See design.md's "Autenticación: dos modalidades según quién entra"
 * table (client: 30 días) and "La cuenta del dueño" (owner: 8h, shorter
 * than the other staff's 12h — it is the only account that sees the shop's
 * billing).
 */
export const SESSION_TTL_MINUTES_BY_SUBJECT: Record<SessionSubjectKind, number> = {
  client: 30 * 24 * 60,
  staff: 12 * 60,
  owner: 8 * 60,
};

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
