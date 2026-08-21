import { FakeAuthChallengeRepository, FakeClientAccountRepository, FakeClock, FakeNotificationOutboxRepository } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ChallengeService } from './challenge-service';
import { RequestClientAccessUseCase } from './request-client-access';

// cuenta-cliente-persistente RED: the shop owner wants "pedir un codigo de
// acceso" keyed by the EMAIL the client just typed at the end of a web
// booking, not the phone. `RequestClientAccessUseCase`'s own doc comment
// explains why phone was the original key (a phone-booked client may have
// no email) — that reasoning does not cover a web booking, which always
// captures an email, so this switches the lookup to
// `ClientAccountRepository.findByEmail`, the same single-hop idiom
// `ResetPasswordUseCase.request` already uses via
// `UserCredentialsRepository.findByEmail`.
//
// The non-disclosure discipline from 10.4/10.5 carries over unchanged: every
// branch returns the exact same `{ outcome: 'requested' }`, whether or not
// the email is on file at all.

function build() {
  const accounts = new FakeClientAccountRepository();
  const challenges = new FakeAuthChallengeRepository();
  const outbox = new FakeNotificationOutboxRepository();
  const clock = new FakeClock(-180, new FakeClock().localTimeToUtc('2026-09-01', '09:00'));
  const useCase = new RequestClientAccessUseCase(accounts, new ChallengeService(challenges, clock), outbox);
  return { accounts, challenges, outbox, useCase };
}

describe('RequestClientAccessUseCase (cuenta-cliente-persistente)', () => {
  it('entrega el codigo cuando el email pertenece a una cuenta web real', async () => {
    const { accounts, challenges, outbox, useCase } = build();
    const account = await accounts.create({ clientId: 'client-1', email: 'sofia@example.com' });

    await useCase.execute({ email: 'sofia@example.com' });

    expect(challenges.createCalls).toHaveLength(1);
    expect(challenges.createCalls[0]?.userId).toBe(account.id);
    expect(outbox.enqueued).toHaveLength(1);
    expect(outbox.enqueued[0]).toMatchObject({
      notificationType: 'client_access_code',
      recipientEmail: 'sofia@example.com',
    });
    expect(outbox.enqueued[0]?.payload).toMatchObject({ challengeId: challenges.createCalls[0]?.id });
  });

  it('no emite nada para un email que no pertenece a ninguna cuenta web', async () => {
    const { challenges, outbox, useCase } = build();

    await useCase.execute({ email: 'nadie@example.com' });

    expect(challenges.createCalls).toEqual([]);
    expect(outbox.enqueued).toEqual([]);
  });

  it('responde exactamente igual exista o no la cuenta — no es un oraculo de emails registrados', async () => {
    const { accounts, useCase } = build();
    await accounts.create({ clientId: 'client-1', email: 'sofia@example.com' });

    const delivered = await useCase.execute({ email: 'sofia@example.com' });
    const unknown = await useCase.execute({ email: 'nadie@example.com' });

    expect(unknown).toEqual(delivered);
    expect(delivered).toEqual({ outcome: 'requested' });
  });
});
