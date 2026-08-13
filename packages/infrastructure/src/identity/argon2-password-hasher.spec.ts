import { describe, expect, it } from 'vitest';

import { Argon2PasswordHasher } from './argon2-password-hasher';

// The PHC string format argon2 libraries emit embeds every parameter needed
// to reproduce the hash: $argon2id$v=19$m=<memoryCost>,t=<timeCost>,p=<parallelism>$<salt>$<hash>
// Asserting on this shape is how we prove the OWASP-recommended parameters
// (19 MiB, 2 iterations, parallelism 1) are actually the ones in effect,
// rather than trusting a hardcoded options object nobody re-checks.
const OWASP_ARGON2ID_PARAMS = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/;

describe('Argon2PasswordHasher', () => {
  it('hashes with the argon2id algorithm at OWASP-recommended parameters (19 MiB, t=2, p=1)', async () => {
    const hasher = new Argon2PasswordHasher();

    const hash = await hasher.hash('correct-horse-battery-staple');

    expect(hash).toMatch(OWASP_ARGON2ID_PARAMS);
  });

  it('verifies a password against its own hash', async () => {
    const hasher = new Argon2PasswordHasher();
    const hash = await hasher.hash('correct-horse-battery-staple');

    const result = await hasher.verify(hash, 'correct-horse-battery-staple');

    expect(result).toBe(true);
  });

  it('rejects a wrong password against a real hash', async () => {
    const hasher = new Argon2PasswordHasher();
    const hash = await hasher.hash('correct-horse-battery-staple');

    const result = await hasher.verify(hash, 'wrong-guess');

    expect(result).toBe(false);
  });

  it('produces a different hash (fresh random salt) for the same password on every call', async () => {
    const hasher = new Argon2PasswordHasher();

    const first = await hasher.hash('correct-horse-battery-staple');
    const second = await hasher.hash('correct-horse-battery-staple');

    expect(first).not.toBe(second);
  });

  it('never authenticates via verifyDummy, regardless of the guess', async () => {
    const hasher = new Argon2PasswordHasher();

    const result = await hasher.verifyDummy('any-guess-at-all');

    expect(result).toBe(false);
  });

  // The whole point of verifyDummy: a login attempt for an email that matches
  // no user must still pay ~the same argon2id cost as a real verification, so
  // response timing cannot be used to enumerate which emails have accounts.
  // verifyDummy is built to literally call the same verify() primitive
  // against a fixed internal hash (see production code) rather than
  // short-circuiting, so its cost should sit in the same order of magnitude
  // as a real verify() — not e.g. orders of magnitude faster.
  it('pays comparable computational cost to a real verification', async () => {
    const hasher = new Argon2PasswordHasher();
    const realHash = await hasher.hash('correct-horse-battery-staple');

    const realStart = performance.now();
    await hasher.verify(realHash, 'correct-horse-battery-staple');
    const realDurationMs = performance.now() - realStart;

    const dummyStart = performance.now();
    await hasher.verifyDummy('any-guess-at-all');
    const dummyDurationMs = performance.now() - dummyStart;

    // Generous lower bound to avoid CI/scheduler jitter flakiness: the point
    // is ruling out a cheap short-circuit (e.g. an early `return false`),
    // not asserting near-exact timing equality.
    expect(dummyDurationMs).toBeGreaterThan(realDurationMs * 0.3);
  });
});
