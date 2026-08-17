import type { AuthChallengePurpose } from '@jc-barberia/domain';

import type { ChallengeService } from './challenge-service';

export interface ClientLoginInput {
  readonly challengeId: string;
  /** The 6-digit code the client typed, or the token from the magic link
   *  they followed — either one authenticates. */
  readonly secret: string;
}

export type ClientLoginResult =
  | { readonly outcome: 'authenticated'; readonly userId: string }
  /**
   * The challenge is dead — expired, out of attempts, or already spent.
   * Retrying the same one can never succeed, so the caller must send the
   * client back to "request a new code" (client-booking spec, "Código de
   * acceso vencido": rechazarlo AND exigir una nueva solicitud).
   */
  | { readonly outcome: 'must-request-new-code'; readonly reason: 'expired' | 'exhausted' | 'consumed' }
  /** Wrong secret on a challenge that is still alive — a retry is meaningful. */
  | { readonly outcome: 'rejected' };

const CLIENT_LOGIN_PURPOSE: AuthChallengePurpose = 'client_login';

/**
 * Authenticates a client through the passwordless challenge — never a
 * password: no field of this input, this result, or anything
 * `ChallengeService` touches along the way represents one. Every
 * atomicity/expiry/attempt-limit guarantee is `ChallengeService.consume`'s
 * responsibility; this use case only maps the outcome and pins the purpose
 * to `client_login`, so a staff-activation or password-reset challenge can
 * never authenticate a client session through this path.
 */
export class ClientLoginUseCase {
  constructor(private readonly challenges: ChallengeService) {}

  async execute(input: ClientLoginInput): Promise<ClientLoginResult> {
    const result = await this.challenges.consume({
      challengeId: input.challengeId,
      purpose: CLIENT_LOGIN_PURPOSE,
      secret: input.secret,
    });
    if (!result.consumed) {
      // Only `mismatch` leaves the challenge usable. Everything else means the
      // client needs a fresh code, and saying so is the requirement's second
      // half — without it the web can only ever offer "try again", on a
      // challenge that can never succeed.
      return result.reason === 'mismatch'
        ? { outcome: 'rejected' }
        : { outcome: 'must-request-new-code', reason: result.reason };
    }
    return { outcome: 'authenticated', userId: result.userId };
  }
}
