import type { EmailTemplateRenderer } from './types';

/**
 * A MINIMAL reminder used until 7.11 splits it into the two
 * `DepositState`-aware variants. It mentions "seña" generically and does NOT
 * yet compute the "última oportunidad" cutoff — on purpose: 7.9 RED proves the
 * con-seña reminder owes the cutoff wording, and 7.10 RED proves the sin-seña
 * reminder owes NO seña mention; both fail against THIS generic body, so 7.11
 * GREEN replaces it with the two deposit-aware renderers.
 *
 * The payload (`{ appointmentId, appointmentTime }`, ISO) is the one the
 * `appointment.reminder` handler wrote to the outbox (6.10/6.11).
 */
export const genericReminderTemplate: EmailTemplateRenderer = ({ appointmentId, appointmentTime }) => ({
  subject: 'JC Barberia — recordatorio de tu turno',
  body: [
    'Te recordamos tu turno en JC Barberia.',
    '',
    'Si necesitas cancelar y recuperar tu seña, hace lo con anticipacion.',
    '',
    `(Turno ${appointmentId} — ${appointmentTime})`,
  ].join('\n'),
});
