import type { EmailTemplateRenderer } from './types';

/**
 * "Recordatorio de un turno sin seña" — the sin-seña branch of the
 * DepositState fork. The notification-port spec is a NEGATIVE requirement here:
 * the reminder MUST NOT mention recovering any seña, because there is none (a
 * phone or walk-in turno without a deposit). So no "seña", no "última
 * oportunidad", no cancel-cutoff — the cutoff only exists to protect a refund,
 * and there is no refund to protect. A plain "we'll see you" reminder.
 *
 * The reminder fires 2h before the turno alike — the email gate is the only
 * one (no channel branch, no deposit branch at the dispatch level); the deposit
 * fork lives entirely in WHICH renderer the registry routes to.
 */
export const reminderWithoutDepositTemplate: EmailTemplateRenderer = ({ appointmentId = '', appointmentTime = '' }) => ({
  subject: 'JC Barberia — recordatorio de tu turno',
  body: [
    'Te recordamos tu turno en JC Barberia.',
    '',
    'Si necesitás cancelar, avisanos con anticipación.',
    '',
    `(Turno ${appointmentId} — ${appointmentTime})`,
  ].join('\n'),
});
