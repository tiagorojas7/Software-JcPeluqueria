import type { EmailTemplateRenderer } from './types';

/**
 * "Código o enlace de acceso a la cuenta sin contraseña" — shared by
 * `staff_activation` (the owner inviting staff) and `staff_password_reset` (a
 * forgotten password), the two `AuthChallengePurpose` channels that deliver a
 * single-use token by email. The payload the outbox writer stored is exactly
 * `{ token, expiresAt }` (ISO) — see `ResetPasswordUseCase.request`; the
 * activation writer copies the same shape when it lands. No credential, no
 * transport: the adapter (`GmailNotificationAdapter`) wraps this into a `text`
 * body; a future WhatsApp adapter would collapse it into one message.
 */
export const accessTemplate: EmailTemplateRenderer = ({ token, expiresAt }) => ({
  subject: 'JC Barberia — tu codigo de acceso',
  body: [
    'Usa este codigo de un solo uso para ingresar a tu cuenta de JC Barberia:',
    '',
    `  ${token}`,
    '',
    'El codigo expira y es de un solo uso: si lo pediste de nuevo, usa el mas reciente.',
    `(Vencimiento: ${expiresAt})`,
  ].join('\n'),
});
