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
      return { outcome: 'rejected' };
    }
    return { outcome: 'authenticated', userId: result.userId };
  }
}
