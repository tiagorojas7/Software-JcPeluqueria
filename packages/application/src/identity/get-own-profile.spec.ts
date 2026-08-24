import { FakeClientRepository } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { GetOwnProfileUseCase } from './get-own-profile';

describe('GetOwnProfileUseCase', () => {
  it("returns the authenticated client's own stored details", async () => {
    const clients = new FakeClientRepository();
    clients.seed({ id: 'client-1', name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: 30 });
    const useCase = new GetOwnProfileUseCase(clients);

    const profile = await useCase.execute({ clientId: 'client-1' });

    expect(profile).toEqual({
      id: 'client-1',
      name: 'Marcos',
      phone: '3511234567',
      email: 'marcos@example.com',
      age: 30,
    });
  });

  it('returns null when the session clientId no longer resolves to a client row', async () => {
    const clients = new FakeClientRepository();
    const useCase = new GetOwnProfileUseCase(clients);

    const profile = await useCase.execute({ clientId: 'missing' });

    expect(profile).toBeNull();
  });
});
