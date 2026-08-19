import {
  FakeAuthChallengeRepository,
  FakeClientAccountRepository,
  FakeClientRepository,
  FakeClock,
  FakeNotificationOutboxRepository,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ChallengeService } from './challenge-service';
import { RequestClientAccessUseCase } from './request-client-access';

// 10.4 / 10.5 RED — derived from specs/admin-operations/spec.md, Scenario
// "Cliente telefónico sin email no puede acceder a la cuenta web":
//
//   GIVEN un cliente cuyo único registro proviene de un turno telefónico sin email
//   WHEN intenta solicitar acceso a la cuenta web
//   THEN el sistema MUST NOT poder entregarle un código o enlace de acceso
//
// These two tasks sat blocked for weeks with the note "no hay contra qué
// escribir el RED sin inventar el consumidor" — the reminder job (6.11) and the
// web access flow lived on the other side of the fork. The reconciliation put
// both on one branch, which is what unblocked them.
//
// The sibling scenario ("no recibe recordatorio") is already proven in
// `booking/appointment-reminder.spec.ts`: `AppointmentReminder` returns before
// enqueueing when `clientEmail` is null, so the outbox never holds a row that
// cannot be delivered.
//
// The response is deliberately IDENTICAL in every branch, following
// `ResetPasswordUseCase.request`'s precedent: whether a phone number is on
// file, and whether it carries an email, must not be discoverable by probing
// this endpoint. So each test asserts the INTERNAL facts — challenges created,
// outbox rows enqueued — not a distinguishable reply.

function build() {
  const clients = new FakeClientRepository();
  const accounts = new FakeClientAccountRepository();
  const challenges = new FakeAuthChallengeRepository();
  const outbox = new FakeNotificationOutboxRepository();
  const clock = new FakeClock(-180, new FakeClock().localTimeToUtc('2026-09-01', '09:00'));
  const useCase = new RequestClientAccessUseCase(
    clients,
    accounts,
    new ChallengeService(challenges, clock),
    outbox,
  );
  return { clients, accounts, challenges, outbox, useCase };
}

describe('RequestClientAccessUseCase (10.4/10.5)', () => {
  it('no emite ningun codigo para un cliente telefonico sin email', async () => {
    const { clients, challenges, outbox, useCase } = build();
    await clients.create({ name: 'Marcos', phone: '3511234567', email: null, age: null });

    await useCase.execute({ phone: '3511234567' });

    // "MUST NOT poder entregarle un código o enlace": no challenge exists to
    // be leaked or brute-forced, and nothing is queued for a delivery that
    // has no address to go to.
    expect(challenges.createCalls).toEqual([]);
    expect(outbox.enqueued).toEqual([]);
  });

  it('entrega el codigo cuando el cliente si tiene email y cuenta web', async () => {
    const { clients, accounts, challenges, outbox, useCase } = build();
    const client = await clients.create({
      name: 'Sofia',
      phone: '3519998888',
      email: 'sofia@example.com',
      age: 28,
    });
    await accounts.create({ clientId: client.id, email: 'sofia@example.com' });

    await useCase.execute({ phone: '3519998888' });

    expect(challenges.createCalls).toHaveLength(1);
    expect(outbox.enqueued).toHaveLength(1);
    expect(outbox.enqueued[0]).toMatchObject({
      notificationType: 'client_access_code',
      recipientEmail: 'sofia@example.com',
    });
    // cablear-el-mvp C.1/C.2 — ClientLoginUseCase.execute needs a
    // `challengeId` to scope its guess to one specific challenge (never a
    // bare code alone, which would turn a 6-digit code into a bulk-guessable
    // secret). The HTTP response to "request access" cannot carry it — its
    // shape must stay outcome-identical across all four branches (see the
    // last test in this file) — so the ONLY legitimate channel left is the
    // same one the code and token already travel through: the outbox
    // notification a real client actually receives.
    expect(outbox.enqueued[0]?.payload).toMatchObject({ challengeId: challenges.createCalls[0]?.id });
  });

  it('no emite nada para un cliente con email pero sin cuenta web todavia', async () => {
    const { clients, challenges, outbox, useCase } = build();
    // A phone booking records the email but never creates the passwordless
    // account — that only happens at the end of a web booking (9.7/9.8).
    // Without a `users` row there is nothing to attach a challenge to.
    await clients.create({ name: 'Nora', phone: '3517770001', email: 'nora@example.com', age: null });

    await useCase.execute({ phone: '3517770001' });

    expect(challenges.createCalls).toEqual([]);
    expect(outbox.enqueued).toEqual([]);
  });

  it('no emite nada para un telefono que no existe', async () => {
    const { challenges, outbox, useCase } = build();

    await useCase.execute({ phone: '3510000000' });

    expect(challenges.createCalls).toEqual([]);
    expect(outbox.enqueued).toEqual([]);
  });

  it('responde igual en las cuatro ramas: solicitar acceso no revela quien tiene cuenta', async () => {
    const { clients, accounts, useCase } = build();
    const withAccount = await clients.create({
      name: 'Sofia',
      phone: '3519998888',
      email: 'sofia@example.com',
      age: 28,
    });
    await accounts.create({ clientId: withAccount.id, email: 'sofia@example.com' });
    await clients.create({ name: 'Marcos', phone: '3511234567', email: null, age: null });

    const delivered = await useCase.execute({ phone: '3519998888' });
    const noEmail = await useCase.execute({ phone: '3511234567' });
    const unknown = await useCase.execute({ phone: '3510000000' });

    expect(noEmail).toEqual(delivered);
    expect(unknown).toEqual(delivered);
  });
});
