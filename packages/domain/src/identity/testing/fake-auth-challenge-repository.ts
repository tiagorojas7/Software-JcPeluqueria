import type { AuthChallenge, AuthChallengeRepository } from '../auth-challenge';

/**
 * In-memory `AuthChallengeRepository` test double for application-layer
 * tests — the same role `FakeHoldRepository` plays for `HoldRepository`.
 * `createCalls` records exactly what was asked to be persisted, so a test
 * can assert only hashes ever reach the repository, never the plaintext
 * code/token.
 */
export class FakeAuthChallengeRepository implements AuthChallengeRepository {
  readonly createCalls: AuthChallenge[] = [];

  async create(challenge: AuthChallenge): Promise<void> {
    this.createCalls.push(challenge);
  }
}
