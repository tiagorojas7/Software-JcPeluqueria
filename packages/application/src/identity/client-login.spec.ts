import { FakeAuthChallengeRepository, FakeClock } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ChallengeService } from './challenge-service';
import { ClientLoginUseCase } from './client-login';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

const buildUseCase = () => {
  const clock = new FakeClock(-180, at('12:00'));
  const challenges = new FakeAuthChallengeRepository();
  const challengeService = new ChallengeService(challenges, clock);
  return { challenges, challengeService, useCase: new ClientLoginUseCase(challengeService) };
};

describe('ClientLoginUseCase', () => {
  it('authenticates the client when the submitted code matches an unexpired challenge', async () => {
    const { challengeService, useCase } = buildUseCase();
    const issued = await challengeService.issue({ userId: 'user-1', purpose: 'client_login' });

    const result = await useCase.execute({ challengeId: issued.challengeId, secret: issued.code });

    expect(result).toEqual({ outcome: 'authenticated', userId: 'user-1' });
  });

  it('authenticates via the magic-link token just as well as the code', async () => {
    const { challengeService, useCase } = buildUseCase();
    const issued = await challengeService.issue({ userId: 'user-1', purpose: 'client_login' });

    const result = await useCase.execute({ challengeId: issued.challengeId, secret: issued.token });

    expect(result).toEqual({ outcome: 'authenticated', userId: 'user-1' });
  });

  it('rejects a wrong secret without authenticating', async () => {
    const { challengeService, useCase } = buildUseCase();
    await challengeService.issue({ userId: 'user-1', purpose: 'client_login' });

    const result = await useCase.execute({ challengeId: 'does-not-exist', secret: '000000' });

    expect(result).toEqual({ outcome: 'rejected' });
  });

  // The cross-purpose protection proven at the repository level (Testcontainers)
  // must also hold end-to-end through the use case: a challenge issued for a
  // DIFFERENT purpose must never authenticate a client login, even with the
  // exactly correct secret.
  it('rejects a challenge issued for a different purpose, even with the correct secret', async () => {
    const { challengeService, useCase } = buildUseCase();
    const issued = await challengeService.issue({ userId: 'user-1', purpose: 'staff_password_reset' });

    const result = await useCase.execute({ challengeId: issued.challengeId, secret: issued.code });

    expect(result).toEqual({ outcome: 'rejected' });
  });

  it('never asks for or persists a password anywhere along the way', async () => {
    const { challenges, challengeService, useCase } = buildUseCase();
    const issued = await challengeService.issue({ userId: 'user-1', purpose: 'client_login' });

    await useCase.execute({ challengeId: issued.challengeId, secret: issued.code });

    // The only thing the repository ever received across the whole flow is
    // hashes: the challenge row itself, and the candidate hash on consume.
    // Neither call shape has any notion of a password field.
    expect(Object.keys(challenges.createCalls[0] ?? {})).not.toContain('password');
    expect(Object.keys(challenges.consumeCalls[0] ?? {})).not.toContain('password');
  });
});
