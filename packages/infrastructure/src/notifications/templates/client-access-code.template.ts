import type { Clock } from '@jc-barberia/domain';

import type { EmailTemplateRenderer } from './types';

/**
 * "Código de acceso a la cuenta" — what `RequestClientAccessUseCase` (task
 * 10.5) enqueues so a client can reach their web account. Payload is
 * `{ code, token, expiresAt }`.
 *
 * The client never has a password (client-booking spec), so this message is
 * the ONLY way into their account. It carries both forms of the same secret:
 * the 6-digit code to type, and the magic-link token — two derivations of one
 * `auth_challenges` row, so spending either one spends both.
 *
 * The expiry renders through `Clock` (`parseInstant` + `wallClockTimeOf`),
 * never a raw ISO string: the customer reads shop time, not a UTC offset.
 * Same discipline as `reminder-with-deposit.template.ts`.
 */
export function createClientAccessCodeTemplate(clock: Clock): EmailTemplateRenderer {
  return ({ code = '', token = '', expiresAt = '' }) => {
    const expiry = clock.parseInstant(expiresAt);
    return {
      subject: 'JC Barberia — tu codigo de acceso',
      body: [
        `Tu codigo de acceso es: ${code}`,
        '',
        `Vence a las ${clock.wallClockTimeOf(expiry)} y sirve una sola vez.`,
        'Si vence, pedi uno nuevo desde la web.',
        '',
        'Tambien podes entrar directamente con este enlace:',
        `https://jcbarberia.com/acceso?token=${token}`,
      ].join('\n'),
    };
  };
}
