import type { ClientContext, ClientContextRepository } from '../client-context';

/**
 * In-memory `ClientContextRepository` test double — lets `ClientSessionGuard`
 * (apps/api) be unit-tested without a database, the same role every other
 * `Fake*` repository plays for its port.
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
