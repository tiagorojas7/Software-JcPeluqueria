/**
 * The resolved identity of an authenticated CLIENT session — the mirror
 * image of `ActorContext`, for the population `access-control` explicitly
 * never governs (see `ActorContextRepository`'s own doc comment: "a client
 * session, which access-control never governs"). `userId` is the `users.id`
 * row (`ClientAccount.id`); `clientId` is `users.client_id`, the value every
 * self-service use case (`SelfCancelAppointmentUseCase`, `ListOwnAppointmentsUseCase`)
 * scopes its query by. Never carries a `role` — a client has none, by design
 * (access-control spec, "Autenticación diferenciada según tipo de usuario").
 */
export interface ClientContext {
  readonly userId: string;
  readonly clientId: string;

  /**
   * The session row's CURRENT expiry, as of this resolution — which may
   * have just renewed it (cuenta-cliente-persistente: a still-valid client
   * session slides forward while the client keeps using the app; see
   * `ClientContextRepository.resolveBySessionId`'s own doc comment for the
   * exact rule). `PermissionsGuard` is the only consumer that reads this —
   * it re-issues the session cookie with this value on every request, so a
   * renewed DB row is never left behind by a browser cookie still carrying
   * the OLD expiry (a cookie the browser stops sending once ITS date
   * passes, regardless of what Postgres thinks). Never used for any
   * authorization decision — validity was already decided by the query that
   * produced this context.
   */
  readonly sessionExpiresAt: Date;
}

/**
 * Resolves an opaque session id into a client's own identity — the client
 * counterpart to `ActorContextRepository`, deliberately a SEPARATE port
 * rather than a second branch on it: `access-control` (where
 * `ActorContextRepository` lives) never governs clients, so a client's own
 * resolution seam belongs in `identity`, not there. `null` covers every
 * reason a session doesn't resolve to a client — missing, expired, revoked,
 * or belonging to a staff user (`users.client_id IS NULL`) — the caller
 * cannot distinguish those, by design, the same posture
 * `ActorContextRepository.resolveBySessionId` already takes.
 *
 * cuenta-cliente-persistente: for a CLIENT session specifically (never
 * staff/owner — `ActorContextRepository` has no equivalent, on purpose: a
 * shared shop computer must lock staff out on schedule, design.md's own
 * reasoning for the short, fixed staff/owner TTLs), a successful resolution
 * also renews the session — see the real adapter for the exact half-life
 * rule. Folded into resolution rather than a separate call: this is already
 * the one query every authenticated client request pays for, and renewal is
 * "was this session valid, and how much longer should it stay that way" —
 * the same question, not a second one.
 */
export interface ClientContextRepository {
  resolveBySessionId(sessionId: string): Promise<ClientContext | null>;
}
