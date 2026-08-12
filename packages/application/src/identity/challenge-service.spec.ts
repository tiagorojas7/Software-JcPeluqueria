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

    const issued = await service.issue({ userId: 'user-2', purpose: 'staff_password_reset' });

    expect(issued.expiresAt).toEqual(at('21:00'));
    expect(challenges.createCalls[0]?.purpose).toBe('staff_password_reset');
  });
});
