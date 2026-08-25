import {
  FakeAuthChallengeRepository,
  FakeBarberRepository,
  FakeClock,
  FakeNotificationOutboxRepository,
  FakeStaffAccountRepository,
  createBarber,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ChallengeService } from '../identity/challenge-service';
import { ManageBarberAccountsUseCase } from './manage-barber-accounts';

// RED — derived from README section 3.9 "Perfil del barbero":
//
//   "Cada barbero tiene su perfil. **No es opcional**: es la puerta por la
//   que entra al sistema."
//
// and from access-control, "Contraseñas del personal almacenadas de forma
// segura". Until now the panel could create a `Barber` that showed up in the
// agenda and in public availability while no `users` row existed for that
// person at all — assignable, but unable to log in. This use case is the
// missing half: the account the owner creates, invites, and keeps control
// of, WITHOUT ever handling the password itself.

const clock = new FakeClock(-180, new FakeClock().parseInstant('2026-09-01T12:00:00.000Z'));

function build() {
  const accounts = new FakeStaffAccountRepository();
  const barbers = new FakeBarberRepository();
  const outbox = new FakeNotificationOutboxRepository();
  const challenges = new ChallengeService(new FakeAuthChallengeRepository(), clock);
  const useCase = new ManageBarberAccountsUseCase(accounts, barbers, challenges, outbox);
  return { useCase, accounts, barbers, outbox };
}

async function withBarber() {
  const context = build();
  await context.barbers.create(createBarber({ id: 'barber-1', name: 'Juan', active: true }));
  return context;
}

describe('ManageBarberAccountsUseCase', () => {
  it('creates the barber account and emails an activation invite, never a password', async () => {
    const { useCase, accounts, outbox } = await withBarber();

    const result = await useCase.invite({ barberId: 'barber-1', email: 'juan@jc.test' });

    expect(result.outcome).toBe('invited');
    const account = await accounts.findByBarberId('barber-1');
    expect(account).toMatchObject({
      email: 'juan@jc.test',
      role: 'barber',
      barberId: 'barber-1',
      active: true,
      // The owner created the account; only the barber can finish it.
      activated: false,
    });

    expect(outbox.enqueued).toHaveLength(1);
    const notification = outbox.enqueued[0]!;
    expect(notification.notificationType).toBe('staff_activation');
    expect(notification.recipientEmail).toBe('juan@jc.test');
    expect(notification.payload.challengeId).toBeTruthy();
    expect(notification.payload.token).toBeTruthy();
    // The invite carries a single-use secret, and nothing resembling a
    // credential the owner chose.
    expect(JSON.stringify(notification.payload)).not.toContain('password');
  });

  it('refuses to invite a barber that does not exist, without creating an account', async () => {
    const { useCase, accounts, outbox } = build();

    const result = await useCase.invite({ barberId: 'no-existe', email: 'juan@jc.test' });

    expect(result).toEqual({ outcome: 'barber-not-found' });
    expect(await accounts.findByEmail('juan@jc.test')).toBeNull();
    expect(outbox.enqueued).toEqual([]);
  });

  it('refuses a second account for a barber who already has one', async () => {
    const { useCase, outbox } = await withBarber();
    await useCase.invite({ barberId: 'barber-1', email: 'juan@jc.test' });

    const result = await useCase.invite({ barberId: 'barber-1', email: 'otro@jc.test' });

    expect(result).toEqual({ outcome: 'already-has-account' });
    // No second invite went out either.
    expect(outbox.enqueued).toHaveLength(1);
  });

  it('refuses an email another account already uses — users.email is unique', async () => {
    const { useCase, barbers, accounts } = await withBarber();
    await barbers.create(createBarber({ id: 'barber-2', name: 'Pedro', active: true }));
    await useCase.invite({ barberId: 'barber-1', email: 'juan@jc.test' });

    const result = await useCase.invite({ barberId: 'barber-2', email: 'juan@jc.test' });

    expect(result).toEqual({ outcome: 'email-taken' });
    expect(await accounts.findByBarberId('barber-2')).toBeNull();
  });

  // RED — reproduces the exact failure the shop hit: inviting a barber with
  // an address that already existed as a CLIENT account died on
  // `users_email_unique` (Postgres 23505) and surfaced as a 500. The
  // collision check only looked at STAFF rows, but the UNIQUE constraint
  // covers the whole `users` table — client accounts included.
  it('refuses an email already used by a CLIENT account, instead of dying on the unique constraint', async () => {
    const { useCase, accounts, outbox } = await withBarber();
    accounts.seedNonStaffEmail('tiago@jc.test');

    const result = await useCase.invite({ barberId: 'barber-1', email: 'tiago@jc.test' });

    expect(result).toEqual({ outcome: 'email-taken' });
    expect(await accounts.findByBarberId('barber-1')).toBeNull();
    expect(outbox.enqueued).toEqual([]);
  });

  it('reports a client-owned email as unavailable for an alta too', async () => {
    const { useCase, accounts } = build();
    accounts.seedNonStaffEmail('tiago@jc.test');

    expect(await useCase.emailAvailable('tiago@jc.test')).toBe(false);
    expect(await useCase.emailAvailable('libre@jc.test')).toBe(true);
  });

  it('resends the invite with a FRESH secret — the previous link stops working', async () => {
    const { useCase, accounts, outbox } = await withBarber();
    await useCase.invite({ barberId: 'barber-1', email: 'juan@jc.test' });
    const account = await accounts.findByBarberId('barber-1');
    const firstInvite = outbox.enqueued[0]!.payload;

    const result = await useCase.resendInvite(account!.id);

    expect(result).toEqual({ outcome: 'sent' });
    expect(outbox.enqueued).toHaveLength(2);
    const secondInvite = outbox.enqueued[1]!.payload;
    expect(secondInvite.token).not.toBe(firstInvite.token);
    expect(secondInvite.challengeId).not.toBe(firstInvite.challengeId);
  });

  it('lets the owner resend to an already-activated barber — that is the password reset', async () => {
    const { useCase, accounts, outbox } = await withBarber();
    await useCase.invite({ barberId: 'barber-1', email: 'juan@jc.test' });
    const account = await accounts.findByBarberId('barber-1');
    accounts.markActivated(account!.id);

    const result = await useCase.resendInvite(account!.id);

    expect(result).toEqual({ outcome: 'sent' });
    expect(outbox.enqueued).toHaveLength(2);
  });

  it('answers not-found for a resend to an account id nobody has', async () => {
    const { useCase, outbox } = build();

    expect(await useCase.resendInvite('no-existe')).toEqual({ outcome: 'not-found' });
    expect(outbox.enqueued).toEqual([]);
  });

  it('revokes and restores access without touching the barber row itself', async () => {
    const { useCase, accounts, barbers } = await withBarber();
    await useCase.invite({ barberId: 'barber-1', email: 'juan@jc.test' });
    const account = await accounts.findByBarberId('barber-1');

    expect(await useCase.setActive(account!.id, false)).toBe(true);
    expect((await accounts.findById(account!.id))?.active).toBe(false);
    // Revoking the login never takes the barber out of the agenda — those
    // are two different decisions, and `deactivateBarber` owns the other one.
    expect((await barbers.findById('barber-1'))?.active).toBe(true);

    expect(await useCase.setActive(account!.id, true)).toBe(true);
    expect((await accounts.findById(account!.id))?.active).toBe(true);
  });

  // RED — the gap the real shop exposed: six barbers were already on file
  // from before the alta created accounts, and the owner's screen listed
  // ACCOUNTS, so those six were invisible on it and there was no way to give
  // them one. A screen that can only see the people it already onboarded is
  // useless to a barbershop that already has staff.
  it('lists barbers who have NO account yet, so the owner can still invite them', async () => {
    const { useCase, barbers } = await withBarber();
    await barbers.create(createBarber({ id: 'barber-viejo', name: 'De Antes', active: true }));
    await useCase.invite({ barberId: 'barber-1', email: 'juan@jc.test' });

    const list = await useCase.list();

    expect(list).toContainEqual({
      userId: null,
      barberId: 'barber-viejo',
      barberName: 'De Antes',
      email: null,
      active: false,
      activated: false,
    });
  });

  it('invites a barber who already existed before accounts were a thing', async () => {
    const { useCase, accounts, outbox } = await withBarber();

    const result = await useCase.invite({ barberId: 'barber-1', email: 'deantes@jc.test' });

    expect(result.outcome).toBe('invited');
    expect(await accounts.findByBarberId('barber-1')).toMatchObject({ email: 'deantes@jc.test' });
    expect(outbox.enqueued).toHaveLength(1);
  });

  it('lists every barber account with its barber name and activation state', async () => {
    const { useCase, accounts, barbers } = await withBarber();
    await barbers.create(createBarber({ id: 'barber-2', name: 'Pedro', active: true }));
    await useCase.invite({ barberId: 'barber-1', email: 'juan@jc.test' });
    await useCase.invite({ barberId: 'barber-2', email: 'pedro@jc.test' });
    const juan = await accounts.findByBarberId('barber-1');
    accounts.markActivated(juan!.id);

    const list = await useCase.list();

    expect(list).toEqual([
      {
        userId: juan!.id,
        barberId: 'barber-1',
        barberName: 'Juan',
        email: 'juan@jc.test',
        active: true,
        activated: true,
      },
      {
        userId: (await accounts.findByBarberId('barber-2'))!.id,
        barberId: 'barber-2',
        barberName: 'Pedro',
        email: 'pedro@jc.test',
        active: true,
        activated: false,
      },
    ]);
  });
});
