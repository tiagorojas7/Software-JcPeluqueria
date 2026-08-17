import type {
  AuthChallenge,
  AuthChallengePurpose,
  AuthChallengeRepository,
  ConsumeChallengeResult,
} from '../auth-challenge';

export interface RecordedConsumeCall {
  readonly challengeId: string;
  readonly purpose: AuthChallengePurpose;
  readonly candidateHash: string;
}

/**
 * In-memory `AuthChallengeRepository` test double for application-layer
 * tests — the same role `FakeHoldRepository` plays for `HoldRepository`.
 * `createCalls`/`consumeCalls` record exactly what was asked, so a test can
 * assert only hashes ever reach the repository, never the plaintext
 * code/token.
 *
 * Unlike `DrizzleAuthChallengeRepository`, this fake does not enforce
 * expiry or the attempt limit — it is single-threaded JS with no real
 * concurrency to prove and no consumer that needs those branches faked. The
 * only place those guarantees are proven is the real adapter's
 * Testcontainers suite, exactly like conflict detection is for
 * `FakeHoldRepository`.
 */
export class FakeAuthChallengeRepository implements AuthChallengeRepository {
  readonly createCalls: AuthChallenge[] = [];
  readonly consumeCalls: RecordedConsumeCall[] = [];
  private readonly stored = new Map<
    string,
    { challenge: AuthChallenge; consumed: boolean; expired: boolean; exhausted: boolean }
  >();

  async create(challenge: AuthChallenge): Promise<void> {
    this.createCalls.push(challenge);
    this.stored.set(challenge.id, { challenge, consumed: false, expired: false, exhausted: false });
  }

  /**
   * Test seams. This fake still does not SIMULATE the passage of time or count
   * attempts — the real enforcement is proven only against PostgreSQL in the
   * adapter's Testcontainers suite. These let an application-level test put a
   * challenge into a state the adapter can genuinely produce, so the mapping
   * from that state onto a caller-visible outcome is testable without a
   * database.
   */
  expire(challengeId: string): void {
    const entry = this.stored.get(challengeId);
    if (entry) {
      entry.expired = true;
    }
  }

  exhaustAttempts(challengeId: string): void {
    const entry = this.stored.get(challengeId);
    if (entry) {
      entry.exhausted = true;
    }
  }

  async consume(
    challengeId: string,
    purpose: AuthChallengePurpose,
    candidateHash: string,
  ): Promise<ConsumeChallengeResult> {
    this.consumeCalls.push({ challengeId, purpose, candidateHash });
    const entry = this.stored.get(challengeId);
    // A wrong purpose is reported as `mismatch`, never as a distinct reason:
    // "this id exists but belongs to a staff reset" is precisely the fact a
    // caller on the client-login path must not be able to learn.
    if (!entry || entry.challenge.purpose !== purpose) {
      return { consumed: false, reason: 'mismatch' };
    }
    if (entry.consumed) {
      return { consumed: false, reason: 'consumed' };
    }
    if (entry.expired) {
      return { consumed: false, reason: 'expired' };
    }
    if (entry.exhausted) {
      return { consumed: false, reason: 'exhausted' };
    }
    const { codeHash, tokenHash, userId } = entry.challenge;
    if (candidateHash !== codeHash && candidateHash !== tokenHash) {
      return { consumed: false, reason: 'mismatch' };
    }
    entry.consumed = true;
    return { consumed: true, userId };
  }
}
