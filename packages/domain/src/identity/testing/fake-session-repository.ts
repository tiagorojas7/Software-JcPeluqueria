import type { Session, SessionRepository } from '../session';

interface StoredSession extends Session {
  revoked: boolean;
}

/** In-memory `SessionRepository` test double. Unlike a plain call recorder,
 *  this actually tracks per-session revoked state, so a test can prove
 *  `revokeAllForUser` affects the right sessions and ONLY the right ones —
 *  the exact guarantee that matters for this port. */
export class FakeSessionRepository implements SessionRepository {
  readonly createCalls: Session[] = [];
  readonly revokeAllForUserCalls: string[] = [];
  private readonly sessions = new Map<string, StoredSession>();

  async create(session: Session): Promise<void> {
    this.createCalls.push(session);
    this.sessions.set(session.id, { ...session, revoked: false });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    this.revokeAllForUserCalls.push(userId);
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        session.revoked = true;
      }
    }
  }

  isRevoked(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.revoked ?? false;
  }
}
