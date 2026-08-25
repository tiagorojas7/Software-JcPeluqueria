import type { Clock } from '@jc-barberia/domain';

import type { EmailTemplateRenderer } from './types';

/** Where the activation link lands in the real web app (`apps/web/src/App.tsx`,
 *  `renderPublicRoute`). `StaffActivationPage` reads `challengeId`/`token`
 *  off this exact query string. */
const ACTIVATION_ROUTE = '/personal/activar';

/**
 * The invite the owner sends a new barber (`ManageBarberAccountsUseCase`) —
 * README section 3.9, "Cada barbero tiene su perfil. No es opcional: es la
 * puerta por la que entra al sistema." Payload is
 * `{ challengeId, token, expiresAt }`.
 *
 * This message carries a LINK and no code, which is the opposite choice from
 * `client_access_code` and deliberate: what waits at the other end is a form
 * where the barber types a password of their own, not a 6-digit code they
 * could type on a login screen. There is nothing here for a person to
 * transcribe.
 *
 * The one thing this email must never contain is a password. The owner never
 * chose one — they cannot, by construction (see the use case's own doc
 * comment) — so there is none to send. The barber picks theirs at the link.
 *
 * `publicBaseUrl` follows the precedent `client-access-code.template.ts` set:
 * undefined by default, and when it is missing the link is OMITTED rather
 * than built off a guessed domain. Unlike the client's message, though, this
 * one has no usable fallback — without the link there is no way in at all —
 * so it says so plainly instead of pretending to be actionable.
 */
export function createStaffActivationTemplate(clock: Clock, publicBaseUrl?: string): EmailTemplateRenderer {
  return ({ challengeId = '', token = '', expiresAt = '' }) => {
    const expiry = clock.parseInstant(expiresAt);
    const activationLink = publicBaseUrl
      ? `${publicBaseUrl}${ACTIVATION_ROUTE}?challengeId=${encodeURIComponent(challengeId)}&token=${encodeURIComponent(token)}`
      : null;
    return {
      subject: 'JC Barberia — activa tu cuenta',
      body: [
        'Te dimos de alta en el panel de JC Barberia.',
        '',
        ...(activationLink
          ? [
              'Entra por este enlace y elegi tu contraseña:',
              activationLink,
              '',
              `El enlace vence a las ${clock.wallClockTimeOf(expiry)} y sirve una sola vez.`,
              'Si vence, pedile al dueño que te lo reenvie desde el panel.',
            ]
          : [
              'Falta configurar la direccion publica del sitio, asi que este',
              'aviso no puede incluir el enlace de activacion. Pedile al dueño',
              'que te lo reenvie una vez resuelto.',
            ]),
        '',
        'Nadie mas conoce tu contraseña: la elegis vos en ese enlace.',
      ].join('\n'),
    };
  };
}
