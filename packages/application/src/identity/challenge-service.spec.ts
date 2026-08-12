import { FakeAuthChallengeRepository, FakeClock } from '@jc-barberia/domain';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ChallengeService } from './challenge-service';

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');
const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

describe('ChallengeService.issue', () => {
  it('derives a 6-digit code and a magic-link token from the same challenge, hashing both before persisting', async () => {
    const clock = new FakeClock(-180, at('12:00'));
    const challenges = new FakeAuthChallengeRepository();
    const service = new ChallengeService(challenges, clock);

    const issued = await service.issue({ userId: 'user-1', purpose: 'client_login' });

    expect(issued.code).toMatch(/^\d{6}$/);
    expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
    expect(challenges.createCalls).toHaveLength(1);
    const persisted = challenges.createCalls[0];
    if (!persisted) {
      throw new Error('expected a challenge to have been persisted');
    }
    expect(persisted).toMatchObject({
      id: issued.challengeId,
      userId: 'user-1',
      purpose: 'client_login',
      expiresAt: at('12:10'),
    });
    // The hash must actually be derived from the returned plaintext — not a
    // coincidentally-shaped string — and the plaintext itself must never be
    // the value that got persisted.
    expect(persisted.codeHash).toBe(sha256Hex(issued.code));
    expect(persisted.tokenHash).toBe(sha256Hex(issued.token));
    expect(persisted.codeHash).not.toBe(issued.code);
    expect(persisted.tokenHash).not.toBe(issued.token);
    expect(Object.keys(persisted)).not.toContain('code');
    expect(Object.keys(persisted)).not.toContain('token');
  });

  it('generates a fresh id, code and token on every call', async () => {
    const clock = new FakeClock(-180, at('12:00'));
    const challenges = new FakeAuthChallengeRepository();
    const service = new ChallengeService(challenges, clock);

    const first = await service.issue({ userId: 'user-1', purpose: 'client_login' });
    const second = await service.issue({ userId: 'user-1', purpose: 'client_login' });

    expect(first.challengeId).not.toBe(second.challengeId);
    expect(first.code).not.toBe(second.code);
    expect(first.token).not.toBe(second.token);
  });

  it('expires exactly CHALLENGE_EXPIRY_MINUTES from whatever "now" is — not a hardcoded instant', async () => {
    const clock = new FakeClock(-180, at('20:50'));
    const challenges = new FakeAuthChallengeRepository();
    const service = new ChallengeService(challenges, clock);

    const issued = await service.issue({ userId: 'user-2', purpose: 'staff_activation' });

    expect(issued.expiresAt).toEqual(at('21:00'));
    expect(challenges.createCalls[0]?.purpose).toBe('staff_activation');
  });

  // Password reset is deliberately longer-lived than the other two purposes
  // (design.md: "Token de 32 bytes ... 30 minutos") — enough time to open a
  // mail client without feeling rushed, unlike a same-session login code.
  it('gives staff_password_reset challenges a 30-minute lifetime, not the 10-minute default', async () => {
    const clock = new FakeClock(-180, at('20:50'));
    const challenges = new FakeAuthChallengeRepository();
    const service = new ChallengeService(challenges, clock);

    const issued = await service.issue({ userId: 'user-2', purpose: 'staff_password_reset' });

    expect(issued.expiresAt).toEqual(at('21:20'));
  });
});

describe('ChallengeService.consume', () => {
  it('hashes the candidate secret before ever asking the repository — never the plaintext', async () => {
    const clock = new FakeClock(-180, at('12:00'));
    const challenges = new FakeAuthChallengeRepository();
    const service = new ChallengeService(challenges, clock);
    const issued = await service.issue({ userId: 'user-1', purpose: 'client_login' });

    await service.consume({ challengeId: issued.challengeId, purpose: 'client_login', secret: issued.code });

    expect(challenges.consumeCalls).toHaveLength(1);
    expect(challenges.consumeCalls[0]).toEqual({
      challengeId: issued.challengeId,
      purpose: 'client_login',
      candidateHash: sha256Hex(issued.code),
    });
  });

  it('returns the userId the repository reports when consumption succeeds', async () => {
    const clock = new FakeClock(-180, at('12:00'));
    const challenges = new FakeAuthChallengeRepository();
    const service = new ChallengeService(challenges, clock);
    const issued = await service.issue({ userId: 'user-42', purpose: 'client_login' });

    const result = await service.consume({
      challengeId: issued.challengeId,
      purpose: 'client_login',
      secret: issued.token,
    });

    expect(result).toEqual({ consumed: true, userId: 'user-42' });
  });

  it('reports failure without throwing when the secret is wrong', async () => {
    const clock = new FakeClock(-180, at('12:00'));
    const challenges = new FakeAuthChallengeRepository();
    const service = new ChallengeService(challenges, clock);
    const issued = await service.issue({ userId: 'user-1', purpose: 'client_login' });

    const result = await service.consume({
      challengeId: issued.challengeId,
      purpose: 'client_login',
      secret: 'wrong-secret',
    });

    expect(result).toEqual({ consumed: false });
  });
});
