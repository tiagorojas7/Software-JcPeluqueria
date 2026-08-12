import {
  FakeAuthChallengeRepository,
  FakeClock,
  FakeNotificationPort,
  FakePasswordHasher,
  FakeSessionRepository,
  FakeUserCredentialsRepository,
  WeakPasswordError,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ChallengeService } from './challenge-service';
import { PasswordService } from './password-service';
import { ResetPasswordUseCase } from './reset-password';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

const buildUseCase = () => {
  const clock = new FakeClock(-180, at('09:00'));
  const challenges = new FakeAuthChallengeRepository();
  const hasher = new FakePasswordHasher();
  const credentials = new FakeUserCredentialsRepository();
  const sessions = new FakeSessionRepository();
  const notifications = new FakeNotificationPort();
  const challengeService = new ChallengeService(challenges, clock);
  const passwordService = new PasswordService(hasher, credentials);
  return {
    challenges,
    hasher,
    credentials,
    sessions,
    notifications,
    challengeService,
    useCase: new ResetPasswordUseCase(credentials, challengeService, passwordService, sessions, notifications),
  };
};

describe('ResetPasswordUseCase.request', () => {
  it('issues a staff_password_reset challenge and dispatches it through the notification port', async () => {
    const { challenges, credentials, notifications, useCase } = buildUseCase();
    credentials.seed({ id: 'owner-1', email: 'dueno@jcbarberia.com', passwordHash: 'fake-hash:old-password', active: true });

    await useCase.request('dueno@jcbarberia.com');

    expect(challenges.createCalls).toHaveLength(1);
    expect(challenges.createCalls[0]).toMatchObject({ userId: 'owner-1', purpose: 'staff_password_reset' });
    expect(notifications.sentMessages).toHaveLength(1);
    expect(notifications.sentMessages[0]).toMatchObject({ to: 'dueno@jcbarberia.com', template: 'staff_password_reset' });
  });

  it('never reveals whether the email exists: same result, no challenge, no notification for an unknown email', async () => {
    const { challenges, notifications, useCase } = buildUseCase();

    const result = await useCase.request('nobody@jcbarberia.com');

    expect(result).toEqual({ outcome: 'requested' });
    expect(challenges.createCalls).toHaveLength(0);
    expect(notifications.sentMessages).toHaveLength(0);
  });

  it('returns the exact same result shape for a known email as for an unknown one', async () => {
    const { credentials, useCase } = buildUseCase();
    credentials.seed({ id: 'owner-1', email: 'dueno@jcbarberia.com', passwordHash: 'fake-hash:old-password', active: true });

    const known = await useCase.request('dueno@jcbarberia.com');
    const unknown = await useCase.request('nobody@jcbarberia.com');

    expect(known).toEqual(unknown);
  });
});

describe('ResetPasswordUseCase.complete', () => {
  it('sets a new password from a valid reset secret', async () => {
    const { credentials, hasher, challengeService, useCase } = buildUseCase();
    credentials.seed({ id: 'owner-1', email: 'dueno@jcbarberia.com', passwordHash: 'fake-hash:old-password', active: true });
    const issued = await challengeService.issue({ userId: 'owner-1', purpose: 'staff_password_reset' });

    const result = await useCase.complete({
      challengeId: issued.challengeId,
      secret: issued.token,
      newPassword: 'a-brand-new-password',
    });

    expect(result).toEqual({ outcome: 'reset', userId: 'owner-1' });
    expect(credentials.setPasswordCalls).toEqual([
      { userId: 'owner-1', passwordHash: await hasher.hash('a-brand-new-password') },
    ]);
  });

  it('never exposes the previous password hash anywhere in the result or the dispatched notification', async () => {
    const { credentials, notifications, challengeService, useCase } = buildUseCase();
    credentials.seed({ id: 'owner-1', email: 'dueno@jcbarberia.com', passwordHash: 'fake-hash:old-password', active: true });
    const issued = await challengeService.issue({ userId: 'owner-1', purpose: 'staff_password_reset' });

    const result = await useCase.complete({
      challengeId: issued.challengeId,
      secret: issued.token,
      newPassword: 'a-brand-new-password',
    });

    expect(JSON.stringify(result)).not.toContain('old-password');
    expect(JSON.stringify(notifications.sentMessages)).not.toContain('old-password');
  });

  it('rejects the wrong secret and never sets a password', async () => {
    const { credentials, challengeService, useCase } = buildUseCase();
    credentials.seed({ id: 'owner-1', email: 'dueno@jcbarberia.com', passwordHash: 'fake-hash:old-password', active: true });
    await challengeService.issue({ userId: 'owner-1', purpose: 'staff_password_reset' });

    const result = await useCase.complete({
      challengeId: 'does-not-exist',
      secret: 'wrong-secret',
      newPassword: 'a-brand-new-password',
    });

    expect(result).toEqual({ outcome: 'rejected' });
    expect(credentials.setPasswordCalls).toHaveLength(0);
  });

  it('is single-use: replaying the same secret after a successful reset is rejected', async () => {
    const { credentials, challengeService, useCase } = buildUseCase();
    credentials.seed({ id: 'owner-1', email: 'dueno@jcbarberia.com', passwordHash: 'fake-hash:old-password', active: true });
    const issued = await challengeService.issue({ userId: 'owner-1', purpose: 'staff_password_reset' });
    await useCase.complete({ challengeId: issued.challengeId, secret: issued.token, newPassword: 'a-brand-new-password' });

    const replay = await useCase.complete({
      challengeId: issued.challengeId,
      secret: issued.token,
      newPassword: 'yet-another-password',
    });

    expect(replay).toEqual({ outcome: 'rejected' });
  });

  it('rejects a challenge issued for a different purpose even with the correct secret', async () => {
    const { credentials, challengeService, useCase } = buildUseCase();
    credentials.seed({ id: 'owner-1', email: 'dueno@jcbarberia.com', passwordHash: 'fake-hash:old-password', active: true });
    const issued = await challengeService.issue({ userId: 'owner-1', purpose: 'client_login' });

    const result = await useCase.complete({
      challengeId: issued.challengeId,
      secret: issued.token,
      newPassword: 'a-brand-new-password',
    });

    expect(result).toEqual({ outcome: 'rejected' });
  });

  it('rejects a weak new password WITHOUT burning the single-use reset link', async () => {
    const { credentials, challengeService, useCase } = buildUseCase();
    credentials.seed({ id: 'owner-1', email: 'dueno@jcbarberia.com', passwordHash: 'fake-hash:old-password', active: true });
    const issued = await challengeService.issue({ userId: 'owner-1', purpose: 'staff_password_reset' });

    await expect(
      useCase.complete({ challengeId: issued.challengeId, secret: issued.token, newPassword: 'short' }),
    ).rejects.toBeInstanceOf(WeakPasswordError);

    const result = await useCase.complete({
      challengeId: issued.challengeId,
      secret: issued.token,
      newPassword: 'a-strong-enough-password',
    });
    expect(result).toEqual({ outcome: 'reset', userId: 'owner-1' });
  });
});

// → access-control: Contraseñas del personal almacenadas de forma segura
// ("Efecto del cambio: cambiar o resetear la contraseña revoca todas las
// sesiones activas de ese usuario" — design.md).
describe('ResetPasswordUseCase.complete revokes sessions', () => {
  it('revokes all of the user’s active sessions after a successful reset', async () => {
    const { credentials, sessions, challengeService, useCase } = buildUseCase();
    credentials.seed({ id: 'owner-1', email: 'dueno@jcbarberia.com', passwordHash: 'fake-hash:old-password', active: true });
    await sessions.create({ id: 'session-1', userId: 'owner-1', expiresAt: at('17:00') });
    await sessions.create({ id: 'session-2', userId: 'owner-1', expiresAt: at('17:00') });
    const issued = await challengeService.issue({ userId: 'owner-1', purpose: 'staff_password_reset' });

    await useCase.complete({ challengeId: issued.challengeId, secret: issued.token, newPassword: 'a-brand-new-password' });

    expect(sessions.revokeAllForUserCalls).toEqual(['owner-1']);
    expect(sessions.isRevoked('session-1')).toBe(true);
    expect(sessions.isRevoked('session-2')).toBe(true);
  });

  it('never revokes another user’s sessions', async () => {
    const { credentials, sessions, challengeService, useCase } = buildUseCase();
    credentials.seed({ id: 'owner-1', email: 'dueno@jcbarberia.com', passwordHash: 'fake-hash:old-password', active: true });
    await sessions.create({ id: 'other-users-session', userId: 'secretary-1', expiresAt: at('17:00') });
    const issued = await challengeService.issue({ userId: 'owner-1', purpose: 'staff_password_reset' });

    await useCase.complete({ challengeId: issued.challengeId, secret: issued.token, newPassword: 'a-brand-new-password' });

    expect(sessions.isRevoked('other-users-session')).toBe(false);
  });

  it('does NOT revoke any session when the reset attempt is rejected', async () => {
    const { credentials, sessions, useCase } = buildUseCase();
    credentials.seed({ id: 'owner-1', email: 'dueno@jcbarberia.com', passwordHash: 'fake-hash:old-password', active: true });
    await sessions.create({ id: 'session-1', userId: 'owner-1', expiresAt: at('17:00') });

    await useCase.complete({ challengeId: 'does-not-exist', secret: 'wrong', newPassword: 'a-brand-new-password' });

    expect(sessions.revokeAllForUserCalls).toHaveLength(0);
    expect(sessions.isRevoked('session-1')).toBe(false);
  });
});
