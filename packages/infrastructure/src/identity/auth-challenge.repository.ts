import {
  MAX_CHALLENGE_ATTEMPTS,
  type AuthChallenge,
  type AuthChallengePurpose,
  type AuthChallengeRepository,
  type ConsumeChallengeResult,
} from '@jc-barberia/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { authChallenges } from '../db/schema/identity';

/**
 * `consume()` is the single-use guarantee, made exactly the same way
 * `HoldRepository.confirm()` makes it: one conditional `UPDATE ... WHERE ...
 * RETURNING`, never a read then a write. The WHERE clause alone enforces
 * "still alive" — unconsumed, unexpired, under the attempt limit — and
 * scopes the row to the expected `purpose`, so a leaked staff-activation
 * link can never be spent through the client-login path.
 *
 * Whether the candidate hash actually matches is decided INSIDE the SET
 * clause via CASE, not the WHERE clause: a wrong guess must still touch the
 * row (to record the failed attempt) rather than silently miss it, and both
 * branches are exactly one round trip either way — never a
 * check-then-increment.
 */
export class DrizzleAuthChallengeRepository implements AuthChallengeRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async create(challenge: AuthChallenge): Promise<void> {
    await this.db.insert(authChallenges).values({
      id: challenge.id,
      userId: challenge.userId,
      purpose: challenge.purpose,
      codeHash: challenge.codeHash,
      tokenHash: challenge.tokenHash,
      expiresAt: challenge.expiresAt,
    });
  }

  async consume(
    challengeId: string,
    purpose: AuthChallengePurpose,
    candidateHash: string,
  ): Promise<ConsumeChallengeResult> {
    const hashMatches = sql`(${authChallenges.codeHash} = ${candidateHash} OR ${authChallenges.tokenHash} = ${candidateHash})`;
    const rows = await this.db
      .update(authChallenges)
      .set({
        consumedAt: sql`CASE WHEN ${hashMatches} THEN now() ELSE ${authChallenges.consumedAt} END`,
        attempts: sql`CASE WHEN ${hashMatches} THEN ${authChallenges.attempts} ELSE ${authChallenges.attempts} + 1 END`,
      })
      .where(
        and(
          eq(authChallenges.id, challengeId),
          eq(authChallenges.purpose, purpose),
          isNull(authChallenges.consumedAt),
          sql`${authChallenges.expiresAt} > now()`,
          sql`${authChallenges.attempts} < ${MAX_CHALLENGE_ATTEMPTS}`,
        ),
      )
      .returning({ userId: authChallenges.userId, consumedAt: authChallenges.consumedAt });

    const row = rows[0];
    return row && row.consumedAt !== null ? { consumed: true, userId: row.userId } : { consumed: false };
  }
}
