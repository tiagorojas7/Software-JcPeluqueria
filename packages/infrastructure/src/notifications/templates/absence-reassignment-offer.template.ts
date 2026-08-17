import type { Clock } from '@jc-barberia/domain';

import type { EmailTemplateRenderer } from './types';

/**
 * "Oferta de reasignación por ausencia de barbero" — the notification
 * `GenerateAbsenceReassignmentOffers` (task 12.5/12.6) enqueues right after
 * claiming a same-day replacement hold. The payload is exactly
 * `{ appointmentId, offeredBarberId, offeredStart, offeredEnd,
 * holdExpiresAt }` (all instants ISO, stored as strings — the outbox payload
 * is a flat `Record<string, string>`). Every instant renders through `Clock`
 * (`parseInstant` + `wallClockTimeOf`/`calendarDateOf`), never a raw ISO
 * string or a `Date` built directly — the same discipline
 * `reminder-with-deposit.template.ts` already established.
 */
export function createAbsenceReassignmentOfferTemplate(clock: Clock): EmailTemplateRenderer {
  return ({ offeredStart = '', offeredEnd = '', holdExpiresAt = '' }) => {
    const start = clock.parseInstant(offeredStart);
    const end = clock.parseInstant(offeredEnd);
    const expiry = clock.parseInstant(holdExpiresAt);
    const date = clock.calendarDateOf(start);
    const startTime = clock.wallClockTimeOf(start);
    const endTime = clock.wallClockTimeOf(end);
    const cutoffTime = clock.wallClockTimeOf(expiry);
    return {
      subject: 'JC Barberia — te ofrecemos un horario alternativo',
      body: [
        'Tu barbero no va a estar disponible para tu turno.',
        '',
        `Te ofrecemos este horario del mismo dia (${date}): de ${startTime} a ${endTime}.`,
        `Confirmalo antes de las ${cutoffTime} o el horario se libera automaticamente.`,
        '',
        'Si preferis cancelar en vez de tomar la alternativa, respondenos a este correo.',
      ].join('\n'),
    };
  };
}
