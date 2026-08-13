import type { Session, SessionRepository } from '@jc-barberia/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { sessions } from '../db/schema/identity';

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async create(session: Session): Promise<void> {
    await this.db.insert(sessions).values({
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
    });
  }

  /** One statement, scoped by `user_id` — never a per-session loop, and the
   *  `revoked_at IS NULL` guard means calling this twice in a row is a safe
   *  no-op rather than clobbering an earlier revocation timestamp. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }
}
