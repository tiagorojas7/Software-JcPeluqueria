import { FakeClock } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { createStaffActivationTemplate } from './staff-activation.template';

// README section 3.9, "Perfil del barbero": the profile is the door the
// barber walks in through, and this invite is the key. It used to share
// `accessTemplate` with `staff_password_reset`, which announced a "código de
// acceso" and printed the raw token — neither what the barber receives nor
// what they are supposed to do with it.

const clock = new FakeClock();
const EXPIRES_AT = clock.localTimeToUtc('2026-09-01', '12:10').toISOString();
const PAYLOAD = { challengeId: 'challenge-1', token: 'tok-abc', expiresAt: EXPIRES_AT };

describe('createStaffActivationTemplate', () => {
  it('builds the activation link off PUBLIC_BASE_URL, pointing at the route the SPA actually serves', () => {
    const template = createStaffActivationTemplate(clock, 'https://jc.example');

    const rendered = template(PAYLOAD);

    expect(rendered.body).toContain('https://jc.example/personal/activar?challengeId=challenge-1&token=tok-abc');
  });

  it('renders the expiry in shop time, never a UTC ISO string', () => {
    const template = createStaffActivationTemplate(clock, 'https://jc.example');

    const rendered = template(PAYLOAD);

    // -03:00: 12:10 local was stored as 15:10 UTC, and the barber reads the
    // shop's clock, not the offset.
    expect(rendered.body).toContain('12:10');
    expect(rendered.body).not.toContain(EXPIRES_AT);
  });

  it('never carries a password, even if one somehow reached the payload', () => {
    const template = createStaffActivationTemplate(clock, 'https://jc.example');

    // No writer puts a password in this payload — `ManageBarberAccountsUseCase`
    // has none to put there. Rendering one anyway proves the template reads
    // only the three keys it documents, so a future writer cannot leak a
    // credential into an email just by adding a field.
    const rendered = template({ ...PAYLOAD, password: 'secreto-del-duenio' });

    expect(rendered.body).not.toContain('secreto-del-duenio');
    expect(rendered.body).toContain('la elegis vos');
  });

  it('omits the link, and says so, when PUBLIC_BASE_URL is unset — unlike the client code, there is no fallback', () => {
    const template = createStaffActivationTemplate(clock);

    const rendered = template(PAYLOAD);

    expect(rendered.body).not.toContain('http');
    // The token is not a usable fallback here: there is no screen where a
    // barber types one, so emitting it would only look like an answer.
    expect(rendered.body).not.toContain('tok-abc');
    expect(rendered.body).toContain('no puede incluir el enlace');
  });
});
