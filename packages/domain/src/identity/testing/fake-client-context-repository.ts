import type { ClientContext, ClientContextRepository } from '../client-context';

/**
 * In-memory `ClientContextRepository` test double — lets `PermissionsGuard`'s
 * `@RequiresClientSession()` branch (apps/api/src/access-control) be
 * unit-tested without a database, the same role every other `Fake*`
 * repository plays for its port. That branch was folded into the same
 * global, deny-by-default guard rather than a second, separately-attached
 * guard class — one authority that can reject a route stays easier to prove
 * exhaustive than two guards a future handler could remember to combine
 * incorrectly.
 */
export class FakeClientContextRepository implements ClientContextRepository {
  private readonly bySessionId = new Map<string, ClientContext>();

  /** Test setup: makes `sessionId` resolve to `context`. */
  seed(sessionId: string, context: ClientContext): void {
    this.bySessionId.set(sessionId, context);
  }

  async resolveBySessionId(sessionId: string): Promise<ClientContext | null> {
    return this.bySessionId.get(sessionId) ?? null;
  }
}
