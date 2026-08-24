import {
  FakeAuthChallengeRepository,
  FakeClientAccountRepository,
  FakeClock,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ChallengeService } from './challenge-service';
import { ClientLoginByEmailUseCase } from './client-login-by-email';
import { ClientLoginUseCase } from './client-login';

// fix/acceso-cliente-sin-id RED: the shop owner was explicit — "la idea es
// que el cliente solo ponga el codigo." The client never sees or types a
// `challengeId`; the browser already knows the email from the step before
// (`RequestClientAccessUseCase`) and carries it forward here. This use case
// is what turns EMAIL + typed code into the same outcome
// `ClientLoginUseCase` already produces from challengeId + secret — without
// ever letting a bare code be matched across every live challenge (that
// would both throw away disambiguation AND let a wrong guess charge an
// attempt against the WRONG challenge).

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

function build() {
  const accounts = new FakeClientAccountRepository();
  const challenges = new FakeAuthChallengeRepository();
  const clock = new FakeClock(-180, at('12:00'));
  const challengeService = new ChallengeService(challenges, clock);
  const clientLogin = new ClientLoginUseCase(challengeService);
  const useCase = new ClientLoginByEmailUseCase(accounts, challengeService, clientLogin);
  return { accounts, challenges, challengeService, useCase };
}

describe('ClientLoginByEmailUseCase (fix/acceso-cliente-sin-id)', () => {
  it('authenticates with the email plus the code from the most recent request, no challengeId typed', async () => {
    const { accounts, challengeService, useCase } = build();
    const account = await accounts.create({ clientId: 'client-1', email: 'sofia@example.com' });
    const issued = await challengeService.issue({ userId: account.id, purpose: 'client_login' });

    const result = await useCase.execute({ email: 'sofia@example.com', secret: issued.code });

    expect(result).toEqual({ outcome: 'authenticated', userId: account.id });
  });

  it('when two codes were requested, the newest one is what authenticates', async () => {
    const { accounts, challengeService, useCase } = build();
    const account = await accounts.create({ clientId: 'client-1', email: 'sofia@example.com' });
    await challengeService.issue({ userId: account.id, purpose: 'client_login' });
    const second = await challengeService.issue({ userId: account.id, purpose: 'client_login' });

    const result = await useCase.execute({ email: 'sofia@example.com', secret: second.code });

    expect(result).toEqual({ outcome: 'authenticated', userId: account.id });
  });

  it('rejects an unknown email exactly like a wrong code — no oracle for registered emails', async () => {
    const { useCase } = build();

    const result = await useCase.execute({ email: 'nadie@example.com', secret: '123456' });

    expect(result).toEqual({ outcome: 'rejected' });
  });

  it('rejects a known email with no active challenge, same as a wrong code', async () => {
    const { accounts, useCase } = build();
    await accounts.create({ clientId: 'client-1', email: 'sofia@example.com' });

    const result = await useCase.execute({ email: 'sofia@example.com', secret: '123456' });

    expect(result).toEqual({ outcome: 'rejected' });
  });

  it('rejects the wrong code on a live challenge without killing it', async () => {
    const { accounts, challengeService, useCase } = build();
    const account = await accounts.create({ clientId: 'client-1', email: 'sofia@example.com' });
    await challengeService.issue({ userId: account.id, purpose: 'client_login' });

    const result = await useCase.execute({ email: 'sofia@example.com', secret: '000000' });

    expect(result).toEqual({ outcome: 'rejected' });
  });

  it('reports an expired challenge as must-request-new-code, same mapping ClientLoginUseCase already owns', async () => {
    const { accounts, challenges, challengeService, useCase } = build();
    const account = await accounts.create({ clientId: 'client-1', email: 'sofia@example.com' });
    const issued = await challengeService.issue({ userId: account.id, purpose: 'client_login' });
    challenges.expire(issued.challengeId);

    const result = await useCase.execute({ email: 'sofia@example.com', secret: issued.code });

    expect(result).toEqual({ outcome: 'must-request-new-code', reason: 'expired' });
  });
});
