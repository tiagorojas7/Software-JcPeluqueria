import type { Clock, ClientContext, ClientContextRepository } from '@jc-barberia/domain';
import { SESSION_TTL_MINUTES_BY_SUBJECT } from '@jc-barberia/domain';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/** Half the client TTL: the "remaining life" threshold under which a
 *  session renews itself back out to the full TTL on use
 *  (cuenta-cliente-persistente). A FRACTION of the TTL, deliberately not
 *  "every request" — see the class doc comment for why. */
const RENEWAL_THRESHOLD_MINUTES = Math.floor(SESSION_TTL_MINUTES_BY_SUBJECT.client / 2);

// `db.execute(sql\`...\`)` bypasses Drizzle's schema-typed column decoders
// (the same reason `db/occupancy-sql.ts`'s `freeRanges` needs `.mapWith` for
// its own raw timestamptz expressions): attaching Drizzle to a postgres-js
// client disables the driver's own timestamp parsing, so `sessionExpiresAt`
// comes back as a raw string here, not a `Date`. `Clock.parseInstant` is
// the sanctioned way to turn that back into a `Date` outside ShopClock/
// FakeClock (same discipline `client-access-code.template.ts` already
// follows) — never a bare `new Date(...)` in this file.
type RawRow = { userId: string; clientId: string; sessionExpiresAt: string };

/**
 * The client counterpart to `DrizzleActorContextRepository` — same one
 * query, one round trip shape (session validity + owner, atomically), but
 * `WHERE users.client_id IS NOT NULL` instead of an INNER JOIN on `roles`.
 * That predicate is what makes a STAFF session resolve to `null` here, the
 * exact mirror of how a client session resolves to `null` on the other
 * repository — each port governs exactly one population, never both.
 *
 * cuenta-cliente-persistente: this is ALSO where the rolling-session
 * renewal lives. `candidate` is the exact same validity check the original
 * query builder version ran (session not revoked, not expired, owner
 * active, `client_id` set); `renewed` is a data-modifying CTE that extends
 * `expires_at` back out to the full client TTL, but ONLY when its WHERE
 * clause matches — i.e. only when the row's remaining life is already under
 * `RENEWAL_THRESHOLD_MINUTES`. When it does not match, `renewed` produces
 * zero rows and nothing is written; the final SELECT's `COALESCE` falls
 * back to the row's untouched `expires_at`. One statement, one round trip,
 * and a write to Postgres ONLY on the (rare) renewing call — never on every
 * request, which is the whole point of a fraction-of-life threshold instead
 * of "touch on every read".
 *
 * Deliberately does NOT re-check revocation inside `renewed`'s WHERE beyond
 * what `candidate` already required: `candidate` already excludes revoked
 * rows entirely (`revoked_at IS NULL`), so a revoked session never reaches
 * the `renewed` CTE at all — revocation stays a single, final statement,
 * never something a later renewal could accidentally undo.
 */
export class DrizzleClientContextRepository implements ClientContextRepository {
  constructor(
    private readonly db: PostgresJsDatabase,
    private readonly clock: Clock,
  ) {}

  async resolveBySessionId(sessionId: string): Promise<ClientContext | null> {
    const result = await this.db.execute<RawRow>(sql`
      WITH candidate AS (
        SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.client_id
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.id = ${sessionId}
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND u.active = true
          AND u.client_id IS NOT NULL
        LIMIT 1
      ),
      renewed AS (
        UPDATE sessions
        SET expires_at = now() + (${SESSION_TTL_MINUTES_BY_SUBJECT.client} * interval '1 minute')
        FROM candidate
        WHERE sessions.id = candidate.session_id
          AND candidate.expires_at < now() + (${RENEWAL_THRESHOLD_MINUTES} * interval '1 minute')
        RETURNING sessions.id AS session_id, sessions.expires_at
      )
      SELECT
        candidate.user_id AS "userId",
        candidate.client_id AS "clientId",
        COALESCE(renewed.expires_at, candidate.expires_at) AS "sessionExpiresAt"
      FROM candidate
      LEFT JOIN renewed ON renewed.session_id = candidate.session_id
    `);
    const row = Array.from(result)[0] as RawRow | undefined;
    if (!row) {
      return null;
    }
    return {
      userId: row.userId,
      clientId: row.clientId,
      sessionExpiresAt: this.clock.parseInstant(row.sessionExpiresAt),
    };
  }
}
