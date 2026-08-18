import type { ClientContext, ClientContextRepository } from '@jc-barberia/domain';
import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { sessions, users } from '../db/schema/identity';

/**
 * The client counterpart to `DrizzleActorContextRepository` — same one
 * query, one round trip shape (session validity + owner, atomically), but
 * `WHERE users.client_id IS NOT NULL` instead of an INNER JOIN on `roles`.
 * That predicate is what makes a STAFF session resolve to `null` here, the
 * exact mirror of how a client session resolves to `null` on the other
 * repository — each port governs exactly one population, never both.
 */
export class DrizzleClientContextRepository implements ClientContextRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async resolveBySessionId(sessionId: string): Promise<ClientContext | null> {
    const rows = await this.db
      .select({ userId: users.id, clientId: users.clientId })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.id, sessionId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
          eq(users.active, true),
          isNotNull(users.clientId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row || !row.clientId) {
      return null;
    }
    return { userId: row.userId, clientId: row.clientId };
  }
}
