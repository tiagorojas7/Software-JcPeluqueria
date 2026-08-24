import type { Clock } from '@jc-barberia/domain';

import type { EmailTemplateRenderer } from './types';

/** Where the magic link lands in the real web app (`apps/web/src/App.tsx`,
 *  `renderPublicRoute`) — never `/acceso`, which is not a route this app
 *  has. `AccessCodePage` reads `challengeId`/`token` off this exact query
 *  string to log the client in without a single field to type. */
const ACCESS_CODE_ROUTE = '/acceder';

/**
 * "Código de acceso a la cuenta" — what `RequestClientAccessUseCase` (task
 * 10.5) enqueues so a client can reach their web account. Payload is
 * `{ challengeId, code, token, expiresAt }`.
 *
 * The client never has a password (client-booking spec), so this message is
 * the ONLY way into their account. It carries both forms of the same secret:
 * the 6-digit code to type, and the magic-link token — two derivations of one
 * `auth_challenges` row, so spending either one spends both.
 *
 * The expiry renders through `Clock` (`parseInstant` + `wallClockTimeOf`),
 * never a raw ISO string: the customer reads shop time, not a UTC offset.
 * Same discipline as `reminder-with-deposit.template.ts`.
 *
 * fix/acceso-cliente-sin-id: `publicBaseUrl` follows the exact precedent
 * `MercadoPagoPaymentAdapter` already set for `PUBLIC_BASE_URL` (see its own
 * constructor doc comment) — undefined by default, and the link is OMITTED
 * entirely rather than built off a guessed or hardcoded domain. The
 * previous body always emitted `https://jcbarberia.com/acceso?token=...`, a
 * domain this app does not own and a route (`/acceso`) it does not have —
 * a link to nowhere is worse than no link, and the plaintext code alone is
 * perfectly usable on its own.
 */
export function createClientAccessCodeTemplate(clock: Clock, publicBaseUrl?: string): EmailTemplateRenderer {
  return ({ challengeId = '', code = '', token = '', expiresAt = '' }) => {
    const expiry = clock.parseInstant(expiresAt);
    const magicLink = publicBaseUrl
      ? `${publicBaseUrl}${ACCESS_CODE_ROUTE}?challengeId=${encodeURIComponent(challengeId)}&token=${encodeURIComponent(token)}`
      : null;
    return {
      subject: 'JC Barberia — tu codigo de acceso',
      body: [
        `Tu codigo de acceso es: ${code}`,
        '',
        `Vence a las ${clock.wallClockTimeOf(expiry)} y sirve una sola vez.`,
        'Si vence, pedi uno nuevo desde la web.',
        ...(magicLink ? ['', 'Tambien podes entrar directamente con este enlace:', magicLink] : []),
      ].join('\n'),
    };
  };
}
