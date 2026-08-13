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
  private readonly stored = new Map<string, { challenge: AuthChallenge; consumed: boolean }>();

  async create(challenge: AuthChallenge): Promise<void> {
    this.createCalls.push(challenge);
    this.stored.set(challenge.id, { challenge, consumed: false });
  }

  async consume(
    challengeId: string,
    purpose: AuthChallengePurpose,
    candidateHash: string,
  ): Promise<ConsumeChallengeResult> {
    this.consumeCalls.push({ challengeId, purpose, candidateHash });
    const entry = this.stored.get(challengeId);
    if (!entry || entry.consumed || entry.challenge.purpose !== purpose) {
      return { consumed: false };
    }
    const { codeHash, tokenHash, userId } = entry.challenge;
    if (candidateHash !== codeHash && candidateHash !== tokenHash) {
      return { consumed: false };
    }
    entry.consumed = true;
    return { consumed: true, userId };
  }
}
