import type { Clock } from '@jc-barberia/domain';

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
 *
 * It used to close with `(Turno <uuid> — <instante UTC>)`: a database id and a
 * timestamp in a timezone the customer does not live in. Now it says WHICH
 * turno it is — barbero, servicio, fecha y hora del local — which is the whole
 * reason to send a reminder at all. That needs a `Clock`, so this renderer
 * became a factory like its con-seña sibling; it still owns no offset math of
 * its own (the `no-restricted-syntax` rule keeps that inside ShopClock).
 */
export function createReminderWithoutDepositTemplate(clock: Clock): EmailTemplateRenderer {
  return ({ appointmentTime = '', barberName = '', serviceName = '' }) => {
    const start = clock.parseInstant(appointmentTime);
    return {
      subject: 'JC Barberia — recordatorio de tu turno',
      body: [
        'Te recordamos tu turno en JC Barberia.',
        '',
        ...(barberName ? [`Barbero: ${barberName}`] : []),
        ...(serviceName ? [`Servicio: ${serviceName}`] : []),
        `Fecha: ${clock.calendarDateOf(start)}`,
        `Hora: ${clock.wallClockTimeOf(start)}`,
        '',
        'Si necesitás cancelar, avisanos con anticipación.',
      ].join('\n'),
    };
  };
}
