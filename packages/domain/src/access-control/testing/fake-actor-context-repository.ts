import type { ActorContext } from '../actor-context';
import type { ActorContextRepository } from '../actor-context-repository';

/** In-memory `ActorContextRepository` test double. Tests seed session id →
 *  actor mappings directly (there is no login-to-session-cookie flow wired
 *  up yet in any test harness) — the same `.seed()` convention
 *  `FakeUserCredentialsRepository` uses. */
export class FakeActorContextRepository implements ActorContextRepository {
  private readonly bySessionId = new Map<string, ActorContext>();

  seed(sessionId: string, actor: ActorContext): void {
    this.bySessionId.set(sessionId, actor);
  }

  async resolveBySessionId(sessionId: string): Promise<ActorContext | null> {
    return this.bySessionId.get(sessionId) ?? null;
  }
}
