import type { ChallengeService } from './challenge-service';

export interface RegisterClientInput {
  readonly name: string;
  readonly phone: string;
  readonly email: string;
}

export type RegisterClientResult =
  | { readonly outcome: 'registered'; readonly userId: string; readonly challengeId: string }
  | { readonly outcome: 'rejected' };

const CLIENT_LOGIN_PURPOSE: string = 'client_login';

export class RegisterClientUseCase {
  constructor(private readonly challengeService: ChallengeService) {}

  async execute(input: RegisterClientInput): Promise<RegisterClientResult> {
    if (!input.name.trim() || !input.phone.trim() || !input.email.trim()) {
      return { outcome: 'rejected' };
    }

    const issued = await this.challengeService.issue({
      userId: input.email,
      purpose: CLIENT_LOGIN_PURPOSE,
    });

    return {
      outcome: 'registered',
      userId: input.email,
      challengeId: issued.challengeId,
    };
  }
}