import {
  FakeClientAccountRepository,
  FakeClientRepository,
  FakeClock,
  FakeHoldRepository,
  type Hold,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { RegisterClientUseCase } from './register-client';

// 9.7 RED — derived from specs/client-booking/spec.md, not from an
// implementation:
//
//   "Cuenta sin contraseña creada al final del flujo" — Scenario "Registro
//   al confirmar la reserva":
//     GIVEN a client with no account who selected a schedule and holds it
//     WHEN they confirm the reservation stating name, phone and email
//     THEN the system creates the passwordless account tied to that data
//     AND it neither asks for nor stores any password
//
// The REJECTED prior implementation of this exact use case passed `userId:
// input.email` straight to a challenge issuer, touched no repository, and
// discarded name/phone after a truthy check — it created no account. This
// test asserts on the actual persisted rows (ClientRepository,
// ClientAccountRepository), not merely on a returned shape a fake could
// satisfy without doing the work.

const clock = new FakeClock();
const at = (time: string) => clock.localTimeToUtc('2026-09-07', time);

function buildHold(overrides: Partial<Hold> = {}): Hold {
  return {
    id: 'hold-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: null,
    channel: 'web',
    timeRange: { start: at('10:00'), end: at('10:30') },
    holdExpiresAt: at('10:15'),
    originOccupancyId: null,
    ...overrides,
  };
}

function buildUseCase(hold: Hold = buildHold()) {
  const clients = new FakeClientRepository();
  const accounts = new FakeClientAccountRepository();
  const holds = new FakeHoldRepository();
  holds.seed(hold);
  const useCase = new RegisterClientUseCase(clients, accounts, holds);
  return { useCase, clients, accounts, holds };
}

describe('RegisterClientUseCase', () => {
  it('persists the client with the exact name/phone/email given, and attaches it to the hold', async () => {
    const { useCase, clients, holds } = buildUseCase();

    const result = await useCase.execute({
      holdId: 'hold-1',
      name: 'Marcos',
      phone: '3511234567',
      email: 'marcos@example.com',
      age: null,
    });

    expect(result.outcome).toBe('registered');
    const stored = await clients.findByPhone('3511234567');
    expect(stored).toMatchObject({ name: 'Marcos', phone: '3511234567', email: 'marcos@example.com' });
    expect(holds.attachClientCalls).toEqual([{ holdId: 'hold-1', clientId: stored?.id }]);
  });

  it('creates a passwordless account — no field of the input, the stored account, or the result represents a password', async () => {
    const { useCase, accounts } = buildUseCase();

    const result = await useCase.execute({
      holdId: 'hold-1',
      name: 'Marcos',
      phone: '3511234567',
      email: 'marcos@example.com',
      age: null,
    });

    expect(result.outcome).toBe('registered');
    if (result.outcome !== 'registered') throw new Error('unreachable');
    const account = await accounts.findByClientId(result.clientId);
    expect(account).toEqual({ id: result.userId, clientId: result.clientId, email: 'marcos@example.com' });
    // Structural check, not just semantic: the persisted account object has
    // no key that could ever hold a credential.
    expect(Object.keys(account ?? {}).some((key) => /pass/i.test(key))).toBe(false);
  });

  it('reuses the existing client and account for a repeat phone/email — never duplicates', async () => {
    const { useCase, clients, accounts } = buildUseCase();
    const existingClient = await clients.create({
      name: 'Marcos',
      phone: '3511234567',
      email: 'marcos@example.com',
      age: null,
    });
    const existingAccount = await accounts.create({ clientId: existingClient.id, email: 'marcos@example.com' });

    const result = await useCase.execute({
      holdId: 'hold-1',
      name: 'Marcos',
      phone: '3511234567',
      email: 'marcos@example.com',
      age: null,
    });

    expect(result).toEqual({ outcome: 'registered', clientId: existingClient.id, userId: existingAccount.id });
  });

  it('never creates the passwordless account when the hold already expired — nothing that grants access is created', async () => {
    const clients = new FakeClientRepository();
    const accounts = new FakeClientAccountRepository();
    const expiredHolds = new FakeHoldRepository(true, true, false); // attachClient always fails
    expiredHolds.seed(buildHold());
    const useCase = new RegisterClientUseCase(clients, accounts, expiredHolds);

    const result = await useCase.execute({
      holdId: 'hold-1',
      name: 'Marcos',
      phone: '3511234567',
      email: 'marcos@example.com',
      age: null,
    });

    expect(result).toEqual({ outcome: 'hold-expired' });
    const client = await clients.findByPhone('3511234567');
    expect(client).not.toBeNull();
    expect(await accounts.findByClientId(client?.id ?? '')).toBeNull();
    expect(expiredHolds.attachClientCalls).toEqual([{ holdId: 'hold-1', clientId: client?.id }]);
  });
});
