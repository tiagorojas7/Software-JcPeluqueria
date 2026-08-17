import type { Clock } from '@jc-barberia/domain';
import type { ChallengeService } from '@jc-barberia/application';
import type { HoldRepository } from '@jc-barberia/domain';

export interface RegisterClientInput {
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly age?: string | null;
}

export interface RegisterClientOutput {
  readonly userId: string;
  readonly challengeId: string;
  readonly authCode: string;
}

export class RegisterClientUseCase {
  constructor(
    private readonly challenges: ChallengeService,
    private readonly holds: HoldRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: RegisterClientInput): Promise<RegisterClientOutput> {
    const challenge = await this.challenges.issue({
      purpose: 'client_login',
      expiresAt: this.clock.addMinutes(this.clock.now(), 10),
    });

    return {
      userId: crypto.randomUUID(),
      challengeId: challenge.id,
      authCode: challenge.code,
    };
  }
}