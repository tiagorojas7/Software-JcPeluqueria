import { FakePasswordHasher, FakeUserCredentialsRepository } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { PasswordService } from './password-service';
import { StaffLoginUseCase } from './staff-login';

const buildUseCase = () => {
  const hasher = new FakePasswordHasher();
  const credentials = new FakeUserCredentialsRepository();
  const passwordService = new PasswordService(hasher, credentials);
  return { hasher, credentials, useCase: new StaffLoginUseCase(passwordService) };
};

describe('StaffLoginUseCase', () => {
  it('authenticates a staff member with the correct email and password', async () => {
    const { hasher, credentials, useCase } = buildUseCase();
    const passwordHash = await hasher.hash('a-strong-password-123');
    credentials.seed({ id: 'user-1', email: 'secretaria@jcbarberia.com', passwordHash, active: true });

    const result = await useCase.execute({ email: 'secretaria@jcbarberia.com', password: 'a-strong-password-123' });

    expect(result).toEqual({ outcome: 'authenticated', userId: 'user-1' });
  });

  it('rejects a wrong password without revealing anything beyond rejection', async () => {
    const { hasher, credentials, useCase } = buildUseCase();
    const passwordHash = await hasher.hash('a-strong-password-123');
    credentials.seed({ id: 'user-1', email: 'secretaria@jcbarberia.com', passwordHash, active: true });

    const result = await useCase.execute({ email: 'secretaria@jcbarberia.com', password: 'wrong-guess' });

    expect(result).toEqual({ outcome: 'rejected' });
  });

  it('rejects a nonexistent email with the exact same shape as a wrong password', async () => {
    const { useCase } = buildUseCase();

    const result = await useCase.execute({ email: 'nobody@jcbarberia.com', password: 'whatever-guess' });

    expect(result).toEqual({ outcome: 'rejected' });
  });

  it('makes the nonexistent-email path pay the same fake-hash cost as a real verification', async () => {
    const { hasher, useCase } = buildUseCase();

    await useCase.execute({ email: 'nobody@jcbarberia.com', password: 'whatever-guess' });

    expect(hasher.verifyDummyCalls).toEqual(['whatever-guess']);
  });
});
