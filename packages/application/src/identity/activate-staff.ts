import { assertValidPassword, type AuthChallengePurpose } from '@jc-barberia/domain';

import type { ChallengeService, IssuedChallenge } from './challenge-service';
import type { PasswordService } from './password-service';

export interface InviteStaffInput {
  readonly userId: string;
}

export interface ActivateStaffInput {
  readonly challengeId: string;
  /** The code or token from the activation link the owner sent. */
  readonly secret: string;
  readonly newPassword: string;
}

export type ActivateStaffResult =
  | { readonly outcome: 'activated'; readonly userId: string }
  | { readonly outcome: 'rejected' };

const STAFF_ACTIVATION_PURPOSE: AuthChallengePurpose = 'staff_activation';

/**
 * Onboards a new staff member (owner/secretary/barber) without ever
 * generating, transmitting or storing a plaintext password: `invite()`
 * issues a single-use activation challenge (the same primitive
 * `ChallengeService` already proves atomic and one-time), and `activate()`
 * lets the staff member pick their OWN password once, consuming the
 * challenge exactly like `ClientLoginUseCase` consumes a login challenge.
 * → access-control: Contraseñas del personal almacenadas de forma segura
 */
export class ActivateStaffUseCase {
  constructor(
    private readonly challenges: ChallengeService,
    private readonly passwords: PasswordService,
  ) {}

  async invite(input: InviteStaffInput): Promise<IssuedChallenge> {
    return this.challenges.issue({ userId: input.userId, purpose: STAFF_ACTIVATION_PURPOSE });
  }

  async activate(input: ActivateStaffInput): Promise<ActivateStaffResult> {
    // Validate BEFORE consuming: a weak password must not burn the
    // single-use link — the staff member should still be able to retry with
    // a stronger one using the very same activation email.
    assertValidPassword(input.newPassword);

    const result = await this.challenges.consume({
      challengeId: input.challengeId,
      purpose: STAFF_ACTIVATION_PURPOSE,
      secret: input.secret,
    });
    if (!result.consumed) {
      return { outcome: 'rejected' };
    }

    await this.passwords.setPassword(result.userId, input.newPassword);
    return { outcome: 'activated', userId: result.userId };
  }
}
