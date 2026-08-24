import {
  EXPIRY_MINUTES_BY_PURPOSE,
  type AuthChallenge,
  type AuthChallengePurpose,
  type AuthChallengeRepository,
  type Clock,
  type ConsumeChallengeResult,
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

export interface ConsumeChallengeInput {
  readonly challengeId: string;
  readonly purpose: AuthChallengePurpose;
  /** Whatever the caller typed (the code) or followed (the token) —
   *  hashed here before it ever reaches the repository. */
  readonly secret: string;
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
    const expiresAt = this.clock.addMinutes(this.clock.now(), EXPIRY_MINUTES_BY_PURPOSE[input.purpose]);

    // fix/acceso-cliente-sin-id, Decision 1: kill any challenge still alive
    // for this (userId, purpose) BEFORE creating the new one, so at most one
    // is ever alive at a time. A client tapping "pedir código" twice is
    // ordinary, not an attack — without this, two live challenges with equal
    // expiresAt (no createdAt column to break the tie) leave
    // `findLatestActiveId` unable to reliably pick the newest, and a correct
    // guess could get rejected while burning an attempt on the wrong row.
    await this.challenges.invalidateActive(input.userId, input.purpose);

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

  /**
   * Verifies whatever secret the caller presents (code or token) against
   * the challenge scoped to `purpose`. The plaintext `secret` is hashed
   * right here — the repository only ever sees `candidateHash`.
   */
  async consume(input: ConsumeChallengeInput): Promise<ConsumeChallengeResult> {
    const candidateHash = sha256Hex(input.secret);
    return this.challenges.consume(input.challengeId, input.purpose, candidateHash);
  }

  /**
   * fix/acceso-cliente-sin-id: the seam `ClientLoginByEmailUseCase` needs to
   * resolve an EMAIL-scoped account down to the one challenge to check a
   * typed code against — never a `challengeId` the client had to type. Pure
   * pass-through to the repository; no hashing involved, unlike `consume()`.
   */
  async findLatestActiveChallengeId(userId: string, purpose: AuthChallengePurpose): Promise<string | null> {
    return this.challenges.findLatestActiveId(userId, purpose);
  }
}
