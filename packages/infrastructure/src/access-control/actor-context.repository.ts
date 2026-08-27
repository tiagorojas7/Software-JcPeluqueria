import type { ActorContext, ActorContextRepository, Role } from '@jc-barberia/domain';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { roles } from '../db/schema/access-control';
import { sessions, users } from '../db/schema/identity';

export class DrizzleActorContextRepository implements ActorContextRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  /** One query, one round trip: session validity (not revoked, not
   *  expired), the user it belongs to, and their role all have to agree
   *  before an actor exists at all — see the port's own doc comment on why
   *  this is never split into two calls. The INNER JOIN on `roles` is what
   *  makes a client session (whose `users.role_id` is always NULL) resolve
   *  to `null` here, same as an unknown or expired session — access-control
   *  never governs clients. */
  async resolveBySessionId(sessionId: string): Promise<ActorContext | null> {
    const rows = await this.db
      .select({ userId: users.id, barberId: users.barberId, role: roles.name })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(
        and(
          eq(sessions.id, sessionId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
          eq(users.active, true),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }
    // A barber with no `barber_id` would be a fail-OPEN actor, not merely an
    // odd one: the guard still grants the `:own` permissions its role
    // carries, while `DrizzleAgendaRepository` and
    // `DrizzleBarberPerformanceRepository` both read an absent `barberId` as
    // "not scoped to any barber" and fall back to the id in the request —
    // so the barber would read every colleague's agenda and earnings by
    // editing one query parameter. No seed produces such a row today; this
    // makes a future one fail as a login that does not work, which someone
    // notices, instead of as an authorization hole, which nobody does.
    if (row.role === 'barber' && !row.barberId) {
      return null;
    }
    return {
      userId: row.userId,
      role: row.role as Role,
      barberId: row.barberId ?? undefined,
    };
  }
}
