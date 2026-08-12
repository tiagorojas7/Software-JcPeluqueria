import { FakePasswordHasher, FakeUserCredentialsRepository, WeakPasswordError } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { PasswordService } from './password-service';

describe('PasswordService.setPassword', () => {
  it('hashes the new password and persists only the hash', async () => {
    const hasher = new FakePasswordHasher();
    const credentials = new FakeUserCredentialsRepository();
    credentials.seed({ id: 'user-1', email: 'owner@jcbarberia.com', passwordHash: null, active: true });
    const service = new PasswordService(hasher, credentials);

    await service.setPassword('user-1', 'a-strong-password-123');

    expect(hasher.hashCalls).toEqual(['a-strong-password-123']);
    expect(credentials.setPasswordCalls).toEqual([
      { userId: 'user-1', passwordHash: await hasher.hash('a-strong-password-123') },
    ]);
  });

  it('rejects a password shorter than the minimum length without hashing or persisting it', async () => {
    const hasher = new FakePasswordHasher();
    const credentials = new FakeUserCredentialsRepository();
    credentials.seed({ id: 'user-1', email: 'owner@jcbarberia.com', passwordHash: null, active: true });
    const service = new PasswordService(hasher, credentials);

    await expect(service.setPassword('user-1', 'short')).rejects.toBeInstanceOf(WeakPasswordError);
    expect(hasher.hashCalls).toHaveLength(0);
    expect(credentials.setPasswordCalls).toHaveLength(0);
  });
});

describe('PasswordService.verify', () => {
  it('authenticates when the password matches the stored hash of an active user', async () => {
    const hasher = new FakePasswordHasher();
    const credentials = new FakeUserCredentialsRepository();
    const storedHash = await hasher.hash('a-strong-password-123');
    credentials.seed({ id: 'user-1', email: 'owner@jcbarberia.com', passwordHash: storedHash, active: true });
    const service = new PasswordService(hasher, credentials);

    const result = await service.verify('owner@jcbarberia.com', 'a-strong-password-123');

    expect(result).toEqual({ outcome: 'valid', userId: 'user-1' });
  });

  it('rejects a wrong password for a real user without throwing', async () => {
    const hasher = new FakePasswordHasher();
    const credentials = new FakeUserCredentialsRepository();
    const storedHash = await hasher.hash('a-strong-password-123');
    credentials.seed({ id: 'user-1', email: 'owner@jcbarberia.com', passwordHash: storedHash, active: true });
    const service = new PasswordService(hasher, credentials);

    const result = await service.verify('owner@jcbarberia.com', 'wrong-guess');

    expect(result).toEqual({ outcome: 'invalid' });
  });

  it('pays the fake-hash cost via verifyDummy when no user matches the email, instead of short-circuiting', async () => {
    const hasher = new FakePasswordHasher();
    const credentials = new FakeUserCredentialsRepository();
    const service = new PasswordService(hasher, credentials);

    const result = await service.verify('nobody@jcbarberia.com', 'whatever-guess');

    expect(result).toEqual({ outcome: 'invalid' });
    expect(hasher.verifyDummyCalls).toEqual(['whatever-guess']);
    // Proves it did NOT go down the real-user verify() path.
    expect(hasher.verifyCalls).toHaveLength(0);
  });

  it('pays the fake-hash cost for a deactivated user too, not just a missing one', async () => {
    const hasher = new FakePasswordHasher();
    const credentials = new FakeUserCredentialsRepository();
    const storedHash = await hasher.hash('a-strong-password-123');
    credentials.seed({ id: 'user-2', email: 'ex-barber@jcbarberia.com', passwordHash: storedHash, active: false });
    const service = new PasswordService(hasher, credentials);

    const result = await service.verify('ex-barber@jcbarberia.com', 'a-strong-password-123');

    expect(result).toEqual({ outcome: 'invalid' });
    expect(hasher.verifyDummyCalls).toEqual(['a-strong-password-123']);
  });
});
