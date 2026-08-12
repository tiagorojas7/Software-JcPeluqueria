/** How long a freshly issued challenge remains valid before it must be reissued. */
export const CHALLENGE_EXPIRY_MINUTES = 10;

/** Wrong-secret submissions allowed before a challenge is permanently invalidated. */
export const MAX_CHALLENGE_ATTEMPTS = 5;

/**
 * What an issued challenge is for. `client_login` is the only purpose this
 * phase implements; `staff_activation`/`staff_password_reset` share this
 * exact table and mechanism starting Phase 3a's later tasks (out of this
 * slice) — declaring the full set now costs nothing and keeps the type
 * honest about the table's real shape.
 */
export type AuthChallengePurpose = 'client_login' | 'staff_activation' | 'staff_password_reset';

/**
 * A one-time passwordless credential. The 6-digit code and the magic-link
 * token are two different secrets derived from the SAME row — either one
 * consumes it. Only their SHA-256 hashes are ever represented here: the
 * plaintext values exist solely in `ChallengeService.issue()`'s return
 * value, long enough to be handed to the caller for delivery, and are never
 * part of this entity.
 */
export interface AuthChallenge {
  readonly id: string;
  readonly userId: string;
  readonly purpose: AuthChallengePurpose;
  readonly codeHash: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface AuthChallengeRepository {
  /** Persists a freshly issued challenge. Only hashes are ever written. */
  create(challenge: AuthChallenge): Promise<void>;
}
