import type { ActorContext } from './actor-context';

/**
 * Resolves an opaque session id — the value a session cookie carries (see
 * design.md's "Sesión — común a ambos") — into the acting user's
 * authorization identity, in a single call. `null` covers every reason a
 * session doesn't resolve to a staff actor: missing, expired, revoked, or
 * belonging to a user with no role (a client session, which access-control
 * never governs) — the caller cannot distinguish those, by design, the same
 * posture as `UserCredentialsRepository.findByEmail`'s "don't leak which
 * case" rule. A single port keeps "is this session even valid" and "who
 * does it belong to" one atomic read, never a lookup followed by a second,
 * separate role query that could observe a session revoked in between.
 */
export interface ActorContextRepository {
  resolveBySessionId(sessionId: string): Promise<ActorContext | null>;
}
