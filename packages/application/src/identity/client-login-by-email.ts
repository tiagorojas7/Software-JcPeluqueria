import type { AuthChallengePurpose, ClientAccountRepository } from '@jc-barberia/domain';

import type { ChallengeService } from './challenge-service';
import { ClientLoginUseCase, type ClientLoginResult } from './client-login';

export interface ClientLoginByEmailInput {
  /**
   * The email the client typed one step earlier, on the SAME screen, to
   * request the code (`RequestClientAccessUseCase`) — carried forward by the
   * browser, never re-typed for this step. See `ClientLoginRequestSchema`'s
   * own doc comment (`packages/contracts`) for the full shape of why.
   */
  readonly email: string;
  /** The 6-digit code the client typed. Never the magic-link token — that
   *  path already carries its own `challengeId` from the link's query
   *  string and goes through `ClientLoginUseCase` directly. */
  readonly secret: string;
}

const CLIENT_LOGIN_PURPOSE: AuthChallengePurpose = 'client_login';

/**
 * The client-facing half of the "the client types six digits, the browser
 * supplies the rest" design: resolves EMAIL -> the account -> the one
 * challenge to check the code against, so the human never sees or types an
 * opaque `challengeId`.
 *
 * Every losing path collapses to the exact same `{ outcome: 'rejected' }'
 * ClientLoginUseCase already returns for "wrong code, challenge alive" —
 * deliberately, so this endpoint stays as non-disclosing as
 * `RequestClientAccessUseCase`: an unknown email and an email with no active
 * challenge must be indistinguishable from an ordinary wrong guess. Only once
 * a specific challenge is resolved does this delegate to
 * `ClientLoginUseCase.execute`, reusing its exact expired/exhausted/consumed
 * mapping rather than duplicating it.
 */
export class ClientLoginByEmailUseCase {
  constructor(
    private readonly accounts: ClientAccountRepository,
    private readonly challenges: ChallengeService,
    private readonly clientLogin: ClientLoginUseCase,
  ) {}

  async execute(input: ClientLoginByEmailInput): Promise<ClientLoginResult> {
    const account = await this.accounts.findByEmail(input.email);
    if (!account) {
      return { outcome: 'rejected' };
    }

    const challengeId = await this.challenges.findLatestActiveChallengeId(account.id, CLIENT_LOGIN_PURPOSE);
    if (!challengeId) {
      return { outcome: 'rejected' };
    }

    return this.clientLogin.execute({ challengeId, secret: input.secret });
  }
}
