import { FakeAuthChallengeRepository, FakeClock, FakePasswordHasher, FakeUserCredentialsRepository, WeakPasswordError } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ActivateStaffUseCase } from './activate-staff';
import { ChallengeService } from './challenge-service';
import { PasswordService } from './password-service';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

const buildUseCase = () => {
  const clock = new FakeClock(-180, at('09:00'));
  const challenges = new FakeAuthChallengeRepository();
  const hasher = new FakePasswordHasher();
  const credentials = new FakeUserCredentialsRepository();
  const challengeService = new ChallengeService(challenges, clock);
  const passwordService = new PasswordService(hasher, credentials);
  return {
    challenges,
    hasher,
    credentials,
    challengeService,
    useCase: new ActivateStaffUseCase(challengeService, passwordService),
  };
};

describe('ActivateStaffUseCase.invite', () => {
  it('issues a single-use staff_activation challenge for the new staff member', async () => {
    const { challenges, useCase } = buildUseCase();

    const issued = await useCase.invite({ userId: 'barber-1' });

    expect(challenges.createCalls).toHaveLength(1);
    expect(challenges.createCalls[0]).toMatchObject({ userId: 'barber-1', purpose: 'staff_activation' });
    expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never generates, transmits or stores a plaintext password when inviting', async () => {
    const { credentials, useCase } = buildUseCase();

    const issued = await useCase.invite({ userId: 'barber-1' });

    expect(Object.keys(issued)).not.toContain('password');
    expect(credentials.setPasswordCalls).toHaveLength(0);
  });
});

describe('ActivateStaffUseCase.activate', () => {
  it('sets the staff member’s first password from a valid activation secret', async () => {
    const { hasher, credentials, useCase } = buildUseCase();
    credentials.seed({ id: 'barber-1', email: 'barbero@jcbarberia.com', passwordHash: null, active: true });
    const issued = await useCase.invite({ userId: 'barber-1' });

    const result = await useCase.activate({
      challengeId: issued.challengeId,
      secret: issued.token,
      newPassword: 'a-brand-new-password',
    });

    expect(result).toEqual({ outcome: 'activated', userId: 'barber-1' });
    expect(credentials.setPasswordCalls).toEqual([
      { userId: 'barber-1', passwordHash: await hasher.hash('a-brand-new-password') },
    ]);
  });

  it('rejects an activation with the wrong secret and never sets a password', async () => {
    const { credentials, useCase } = buildUseCase();
    credentials.seed({ id: 'barber-1', email: 'barbero@jcbarberia.com', passwordHash: null, active: true });
    await useCase.invite({ userId: 'barber-1' });

    const result = await useCase.activate({
      challengeId: 'does-not-exist',
      secret: 'wrong-secret',
      newPassword: 'a-brand-new-password',
    });

    expect(result).toEqual({ outcome: 'rejected' });
    expect(credentials.setPasswordCalls).toHaveLength(0);
  });

  it('is single-use: a second activation attempt with the same secret is rejected', async () => {
    const { credentials, useCase } = buildUseCase();
    credentials.seed({ id: 'barber-1', email: 'barbero@jcbarberia.com', passwordHash: null, active: true });
    const issued = await useCase.invite({ userId: 'barber-1' });
    await useCase.activate({ challengeId: issued.challengeId, secret: issued.token, newPassword: 'a-brand-new-password' });

    const replay = await useCase.activate({
      challengeId: issued.challengeId,
      secret: issued.token,
      newPassword: 'a-different-password-2',
    });

    expect(replay).toEqual({ outcome: 'rejected' });
  });

  it('rejects a challenge issued for a different purpose even with the correct secret', async () => {
    const { challengeService, credentials, useCase } = buildUseCase();
    credentials.seed({ id: 'barber-1', email: 'barbero@jcbarberia.com', passwordHash: null, active: true });
    const issued = await challengeService.issue({ userId: 'barber-1', purpose: 'client_login' });

    const result = await useCase.activate({
      challengeId: issued.challengeId,
      secret: issued.token,
      newPassword: 'a-brand-new-password',
    });

    expect(result).toEqual({ outcome: 'rejected' });
  });

  it('rejects a password shorter than the minimum length WITHOUT burning the single-use link', async () => {
    const { credentials, useCase } = buildUseCase();
    credentials.seed({ id: 'barber-1', email: 'barbero@jcbarberia.com', passwordHash: null, active: true });
    const issued = await useCase.invite({ userId: 'barber-1' });

    await expect(
      useCase.activate({ challengeId: issued.challengeId, secret: issued.token, newPassword: 'short' }),
    ).rejects.toBeInstanceOf(WeakPasswordError);

    // The link must still be usable: rejecting a weak password before
    // consuming the challenge means a real attempt right after still works.
    const result = await useCase.activate({
      challengeId: issued.challengeId,
      secret: issued.token,
      newPassword: 'a-strong-enough-password',
    });
    expect(result).toEqual({ outcome: 'activated', userId: 'barber-1' });
  });
});
