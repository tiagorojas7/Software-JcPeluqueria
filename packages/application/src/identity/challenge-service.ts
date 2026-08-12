import {
  CHALLENGE_EXPIRY_MINUTES,
  type AuthChallenge,
  type AuthChallengePurpose,
  type AuthChallengeRepository,
  type Clock,
} from '@jc-barberia/domain';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';

export interface IssueChallengeInput {
  readonly userId: string;
  readonly purpose: AuthChallengePurpose;
}

export interface IssuedChallenge {
  readonly challengeId: string;
  /** Plaintext 6-digit code. Exists only here and in the caller's hands
   *  (e.g. to hand to `NotificationPort`, wired in a later phase) — never
   *  persisted. */
  readonly code: string;
  /** Plaintext magic-link token — same one-time existence as `code`. */
  readonly token: string;
  readonly expiresAt: Date;
}

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Issues passwordless challenges — the primitive behind both client login
 * and (future) staff activation/reset, all sharing the same
 * `auth_challenges` row shape distinguished by `purpose`. The plaintext code
 * and token exist in memory only long enough to be hashed and handed back to
 * the caller for delivery: `AuthChallengeRepository` never receives them,
 * only their SHA-256 hashes.
 */
export class ChallengeService {
  constructor(
    private readonly challenges: AuthChallengeRepository,
    private readonly clock: Clock,
  ) {}

  async issue(input: IssueChallengeInput): Promise<IssuedChallenge> {
    const challengeId = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const token = randomBytes(32).toString('hex');
    const expiresAt = this.clock.addMinutes(this.clock.now(), CHALLENGE_EXPIRY_MINUTES);

    const challenge: AuthChallenge = {
      id: challengeId,
      userId: input.userId,
      purpose: input.purpose,
      codeHash: sha256Hex(code),
      tokenHash: sha256Hex(token),
      expiresAt,
    };
    await this.challenges.create(challenge);

    return { challengeId, code, token, expiresAt };
  }
}
