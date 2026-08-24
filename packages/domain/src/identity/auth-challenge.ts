/** Default challenge lifetime: `client_login` and `staff_activation` both
 *  use it — neither spec nor design states a distinct duration for
 *  activation links, so it falls back to this same-session default. */
export const CHALLENGE_EXPIRY_MINUTES = 10;

/** `staff_password_reset` gets longer than a same-session login code —
 *  enough time to open an email client without feeling rushed. See
 *  design.md's "Staff — contraseña" table: "Token de 32 bytes ... 30
 *  minutos". */
export const PASSWORD_RESET_EXPIRY_MINUTES = 30;

/** Wrong-secret submissions allowed before a challenge is permanently invalidated. */
export const MAX_CHALLENGE_ATTEMPTS = 5;

/**
 * What an issued challenge is for. All three purposes share this exact
 * table and mechanism, distinguished only by this column — a client login
 * code, a staff activation link, and a staff password-reset link are all
 * structurally the same one-time secret.
 */
export type AuthChallengePurpose = 'client_login' | 'staff_activation' | 'staff_password_reset';

/**
 * `ChallengeService.issue()`'s only source of truth for how long each
 * purpose's challenge lives — centralizing it here means no caller has to
 * know (or risk getting wrong) which duration applies to which purpose.
 */
export const EXPIRY_MINUTES_BY_PURPOSE: Record<AuthChallengePurpose, number> = {
  client_login: CHALLENGE_EXPIRY_MINUTES,
  staff_activation: CHALLENGE_EXPIRY_MINUTES,
  staff_password_reset: PASSWORD_RESET_EXPIRY_MINUTES,
};

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

/**
 * Why a consume lost. The distinction exists for one requirement
 * (client-booking, "Código de acceso vencido"): the caller MUST be able to
 * demand a NEW access request rather than another guess, and it cannot do
 * that if every losing case looks the same.
 *
 * `expired`, `exhausted` and `consumed` all mean the challenge is dead —
 * retrying is pointless, a new one must be issued. Only `mismatch` leaves the
 * challenge alive and a retry meaningful.
 *
 * This describes the CHALLENGE, never the secret: the caller already holds the
 * challenge id, so learning that this particular one is dead tells its
 * legitimate holder nothing they did not already have. `mismatch` deliberately
 * stays a single value — it never reveals how close a guess was, nor whether
 * the id matched a code or a token.
 */
export type ConsumeChallengeFailure = 'expired' | 'exhausted' | 'consumed' | 'mismatch';

export type ConsumeChallengeResult =
  | { readonly consumed: true; readonly userId: string }
  | { readonly consumed: false; readonly reason: ConsumeChallengeFailure };

export interface AuthChallengeRepository {
  /** Persists a freshly issued challenge. Only hashes are ever written. */
  create(challenge: AuthChallenge): Promise<void>;

  /**
   * Atomically checks `candidateHash` against either stored hash and, when
   * the challenge is still alive and scoped to `purpose`, marks it consumed
   * — one round trip, no read-then-write. `consumed: false` covers every
   * losing case alike: wrong secret, already consumed, wrong purpose,
   * expired, or attempts exhausted (see `DrizzleAuthChallengeRepository` for
   * exactly which of those this phase enforces).
   */
  consume(
    challengeId: string,
    purpose: AuthChallengePurpose,
    candidateHash: string,
  ): Promise<ConsumeChallengeResult>;

  /**
   * fix/acceso-cliente-sin-id: resolves EMAIL -> the one challenge to check a
   * typed code against, without the client ever typing an opaque
   * `challengeId` (see `ClientLoginRequestSchema`'s own doc comment in
   * `packages/contracts` for why a bare code alone cannot do this safely).
   *
   * `ChallengeService.issue()` calls `invalidateActive` before creating a new
   * challenge, so at most one `(userId, purpose)` pair is ever alive at once
   * — this never has to break a tie between two challenges issued in the
   * same instant (there is no `createdAt` column, and two challenges issued
   * back-to-back can share the exact same `expiresAt`). This always resolves
   * to the one still-alive challenge — same liveness `consume()` itself
   * enforces: unconsumed, unexpired, under the attempt limit — never a scan
   * matching the candidate secret against every outstanding row (that would
   * mean charging a failed attempt against a DIFFERENT challenge than the one
   * the guess was meant for). `null` when none qualifies.
   *
   * Ordering by `expiresAt DESC` still breaks ties correctly in the adapter
   * even though only one row is ever expected alive — belt and suspenders,
   * not load-bearing.
   */
  findLatestActiveId(userId: string, purpose: AuthChallengePurpose): Promise<string | null>;

  /**
   * fix/acceso-cliente-sin-id, Decision 1: invalidates every still-live
   * challenge already outstanding for this `(userId, purpose)` pair, so the
   * one about to be created via `create()` is the only one left alive.
   *
   * Without this, a client who taps "pedir código" twice — an ordinary thing
   * to do — leaves two live challenges with no reliable way to tell which is
   * newest (see `findLatestActiveId`'s doc comment): the fresh code could get
   * rejected AND burn a failed attempt against the WRONG challenge. Called by
   * `ChallengeService.issue()` before persisting the new challenge, never
   * after — invalidating the challenge this call is about to create would be
   * a bug.
   *
   * "Invalidate" reuses the exact same `consumed` state `consume()` already
   * produces for a genuinely spent challenge — there is no separate
   * "superseded" status. A stale magic-link click on an invalidated challenge
   * therefore reports `must-request-new-code` with reason `consumed`, which
   * is honest: that row can never authenticate again either way.
   */
  invalidateActive(userId: string, purpose: AuthChallengePurpose): Promise<void>;
}
