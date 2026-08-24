import { FakeClock } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { createClientAccessCodeTemplate } from './client-access-code.template';

// fix/acceso-cliente-sin-id: the email always carries the plaintext code
// (usable on its own, no link required), and the magic link is only ever
// built off `PUBLIC_BASE_URL` — the same env var `MercadoPagoPaymentAdapter`
// already reads (see its own constructor doc comment for the precedent this
// follows: omit the link entirely rather than emit one pointing at a domain
// this deployment does not own).

const clock = new FakeClock();
const EXPIRES_AT = clock.localTimeToUtc('2026-09-01', '12:10').toISOString();

describe('createClientAccessCodeTemplate', () => {
  it('always renders the plaintext code, whether or not PUBLIC_BASE_URL is set', () => {
    const template = createClientAccessCodeTemplate(clock);

    const rendered = template({
      challengeId: 'challenge-1',
      code: '123456',
      token: 'tok-abc',
      expiresAt: EXPIRES_AT,
    });

    expect(rendered.body).toContain('123456');
  });

  it('omits the magic link entirely when PUBLIC_BASE_URL is unset — no broken link to a domain this app does not own', () => {
    const template = createClientAccessCodeTemplate(clock);

    const rendered = template({
      challengeId: 'challenge-1',
      code: '123456',
      token: 'tok-abc',
      expiresAt: EXPIRES_AT,
    });

    expect(rendered.body).not.toContain('http');
    expect(rendered.body).not.toContain('jcbarberia.com');
  });

  it('builds the magic link off PUBLIC_BASE_URL, landing on the real /acceder route with both challengeId and token', () => {
    const template = createClientAccessCodeTemplate(clock, 'http://localhost:5175');

    const rendered = template({
      challengeId: 'challenge-1',
      code: '123456',
      token: 'tok-abc',
      expiresAt: EXPIRES_AT,
    });

    expect(rendered.body).toContain('http://localhost:5175/acceder?challengeId=challenge-1&token=tok-abc');
  });
});
