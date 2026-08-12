import type {
  AuthChallenge,
  AuthChallengePurpose,
  AuthChallengeRepository,
  ConsumeChallengeResult,
} from '@jc-barberia/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { authChallenges } from '../db/schema/identity';

/**
 * `consume()` is the single-use guarantee, made exactly the same way
 * `HoldRepository.confirm()` makes it: one conditional `UPDATE ... WHERE ...
 * RETURNING`, never a read then a write. The WHERE clause scopes the row to
 * the expected `purpose` and to still-unconsumed, so a leaked
 * staff-activation link can never be spent through the client-login path,
 * and a replay of an already-consumed challenge always loses.
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
    const rows = await this.db
      .update(authChallenges)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(authChallenges.id, challengeId),
          eq(authChallenges.purpose, purpose),
          isNull(authChallenges.consumedAt),
          sql`(${authChallenges.codeHash} = ${candidateHash} OR ${authChallenges.tokenHash} = ${candidateHash})`,
        ),
      )
      .returning({ userId: authChallenges.userId });

    const row = rows[0];
    return row ? { consumed: true, userId: row.userId } : { consumed: false };
  }
}
