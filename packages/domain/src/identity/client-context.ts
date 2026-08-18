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
 */
export interface ClientContextRepository {
  resolveBySessionId(sessionId: string): Promise<ClientContext | null>;
}
