import {
  MAX_CHALLENGE_ATTEMPTS,
  type AuthChallenge,
  type AuthChallengePurpose,
  type AuthChallengeRepository,
  type ConsumeChallengeResult,
} from '@jc-barberia/domain';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
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
    if (row && row.consumedAt !== null) {
      return { consumed: true, userId: row.userId };
    }
    // The row came back untouched-by-CASE: it was alive and the guess simply
    // did not match. The attempt has already been recorded by the same
    // statement — nothing more to look up.
    if (row) {
      return { consumed: false, reason: 'mismatch' };
    }
    return { consumed: false, reason: await this.classifyMiss(challengeId, purpose) };
  }

  /**
   * Zero rows means the WHERE excluded the challenge, and the caller needs to
   * know whether a retry could ever work (client-booking, "Código de acceso
   * vencido": the system must demand a NEW request, not another guess).
   *
   * Safe to read AFTER the fact: the conditional UPDATE has already run and
   * already lost, so this adds no read-then-write race — it only explains a
   * decision the database has finished making. It runs exclusively on the
   * losing path, so the winning case is still exactly one round trip.
   */
  private async classifyMiss(
    challengeId: string,
    purpose: AuthChallengePurpose,
  ): Promise<'expired' | 'exhausted' | 'consumed' | 'mismatch'> {
    const found = await this.db
      .select({
        consumedAt: authChallenges.consumedAt,
        attempts: authChallenges.attempts,
        expired: sql<boolean>`${authChallenges.expiresAt} <= now()`,
      })
      .from(authChallenges)
      .where(and(eq(authChallenges.id, challengeId), eq(authChallenges.purpose, purpose)))
      .limit(1);

    const state = found[0];
    // No row under this id AND purpose is reported as `mismatch`, never as its
    // own reason: "this id exists but belongs to a staff reset" is exactly the
    // fact the client-login path must not be able to learn. The purpose stays
    // in the WHERE for the same reason it is in `consume`'s.
    if (!state) {
      return 'mismatch';
    }
    if (state.consumedAt !== null) {
      return 'consumed';
    }
    if (state.expired) {
      return 'expired';
    }
    return state.attempts >= MAX_CHALLENGE_ATTEMPTS ? 'exhausted' : 'mismatch';
  }

  async findLatestActiveId(userId: string, purpose: AuthChallengePurpose): Promise<string | null> {
    const rows = await this.db
      .select({ id: authChallenges.id })
      .from(authChallenges)
      .where(
        and(
          eq(authChallenges.userId, userId),
          eq(authChallenges.purpose, purpose),
          isNull(authChallenges.consumedAt),
          sql`${authChallenges.expiresAt} > now()`,
          sql`${authChallenges.attempts} < ${MAX_CHALLENGE_ATTEMPTS}`,
        ),
      )
      // Furthest-out expiry == issued last, since every purpose's window is a
      // fixed duration (`EXPIRY_MINUTES_BY_PURPOSE`) — see this method's own
      // doc comment on `AuthChallengeRepository`.
      .orderBy(desc(authChallenges.expiresAt))
      .limit(1);

    return rows[0]?.id ?? null;
  }

  /**
   * fix/acceso-cliente-sin-id, Decision 1: marks every still-alive
   * `(userId, purpose)` row consumed, the exact same terminal state a real
   * `consume()` produces — there is no separate "superseded" column. Scoped
   * with the same liveness predicate `consume()`/`findLatestActiveId` use, so
   * an already-dead row is left alone (no reason to touch what a caller can
   * no longer learn anything new from). `ChallengeService.issue()` calls this
   * BEFORE `create()`, so the challenge about to be created is never at risk
   * of matching its own predicate.
   */
  async invalidateActive(userId: string, purpose: AuthChallengePurpose): Promise<void> {
    await this.db
      .update(authChallenges)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(authChallenges.userId, userId),
          eq(authChallenges.purpose, purpose),
          isNull(authChallenges.consumedAt),
          sql`${authChallenges.expiresAt} > now()`,
          sql`${authChallenges.attempts} < ${MAX_CHALLENGE_ATTEMPTS}`,
        ),
      );
  }
}
