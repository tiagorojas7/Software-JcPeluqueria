import { FakeAuthChallengeRepository, FakeClock } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ChallengeService } from './challenge-service';
import { ClientLoginUseCase } from './client-login';

// 9.9 RED — derived from specs/client-booking/spec.md, Scenario
// "Código de acceso vencido":
//
//   GIVEN un cliente que recibió un código o enlace de acceso a su cuenta
//   WHEN intenta usarlo después de su plazo de expiración
//   THEN el sistema MUST rechazarlo
//   AND MUST exigir una nueva solicitud de acceso
//
// The rejection half already worked: `ChallengeService.consume` has refused
// expired rows since 3a.7. What did NOT work is the second half. Every losing
// case collapsed into one indistinguishable `{ consumed: false }`, so the web
// could not tell "your code expired — ask for another" apart from "wrong
// digits — try again". Requiring a new request is not something the caller can
// demand if it cannot tell the two apart.
//
// Expiry is a property of the CHALLENGE, which the caller already holds the id
// of, so saying "this one is dead" reveals nothing to its legitimate holder
// that they did not already have. The secret itself is never described.

function build() {
  const challenges = new FakeAuthChallengeRepository();
  const clock = new FakeClock(-180, new FakeClock().localTimeToUtc('2026-09-01', '09:00'));
  const service = new ChallengeService(challenges, clock);
  return { challenges, service, useCase: new ClientLoginUseCase(service) };
}

describe('Código de acceso vencido (9.9)', () => {
  it('rechaza un codigo vencido y pide explicitamente una nueva solicitud', async () => {
    const { challenges, service, useCase } = build();
    const issued = await service.issue({ userId: 'user-1', purpose: 'client_login' });
    challenges.expire(issued.challengeId);

    const result = await useCase.execute({ challengeId: issued.challengeId, secret: issued.code });

    expect(result).toEqual({ outcome: 'must-request-new-code', reason: 'expired' });
  });

  it('agotar los intentos tambien exige una nueva solicitud, no un reintento mas', async () => {
    const { challenges, service, useCase } = build();
    const issued = await service.issue({ userId: 'user-1', purpose: 'client_login' });
    challenges.exhaustAttempts(issued.challengeId);

    const result = await useCase.execute({ challengeId: issued.challengeId, secret: issued.code });

    expect(result).toEqual({ outcome: 'must-request-new-code', reason: 'exhausted' });
  });

  it('un codigo equivocado sobre un challenge vivo se rechaza sin pedir uno nuevo — todavia puede reintentar', async () => {
    const { service, useCase } = build();
    const issued = await service.issue({ userId: 'user-1', purpose: 'client_login' });

    const result = await useCase.execute({ challengeId: issued.challengeId, secret: '000000' });

    expect(result).toEqual({ outcome: 'rejected' });
  });

  it('un codigo correcto sobre un challenge vivo sigue autenticando', async () => {
    const { service, useCase } = build();
    const issued = await service.issue({ userId: 'user-1', purpose: 'client_login' });

    const result = await useCase.execute({ challengeId: issued.challengeId, secret: issued.code });

    expect(result).toEqual({ outcome: 'authenticated', userId: 'user-1' });
  });

  it('un challenge ya consumido exige uno nuevo: es de un solo uso, reintentar no sirve', async () => {
    const { service, useCase } = build();
    const issued = await service.issue({ userId: 'user-1', purpose: 'client_login' });
    await useCase.execute({ challengeId: issued.challengeId, secret: issued.code });

    const second = await useCase.execute({ challengeId: issued.challengeId, secret: issued.code });

    expect(second).toEqual({ outcome: 'must-request-new-code', reason: 'consumed' });
  });
});
