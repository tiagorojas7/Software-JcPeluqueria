import type { Clock } from '@jc-barberia/domain';

import type { EmailTemplateRenderer } from './types';

/**
 * "Tu turno cambió" — fired by `EditAppointmentUseCase` whenever staff edit
 * an existing turno's barbero, servicio or horario (panel-usable: "nobody
 * tells the client their appointment changed"). Until this template existed
 * a client whose turno staff edited heard nothing at all — they could show
 * up at the old time, for the old service, with no warning. The payload is
 * `{ barberName, serviceName, appointmentTime }` (all strings, same flat
 * shape every other template in this directory uses) — the turno's state
 * AFTER the edit, so the client always reads what is true now rather than
 * having to reconcile a diff against a previous message.
 * `appointmentTime` renders through `Clock` (`parseInstant` +
 * `calendarDateOf` + `wallClockTimeOf`), never a raw ISO string or a `Date`
 * built directly — same discipline `booking-confirmed.template.ts` follows.
 */
export function createAppointmentUpdatedTemplate(clock: Clock): EmailTemplateRenderer {
  return ({ barberName = '', serviceName = '', appointmentTime = '' }) => {
    const start = clock.parseInstant(appointmentTime);
    const date = clock.calendarDateOf(start);
    const time = clock.wallClockTimeOf(start);
    return {
      subject: 'JC Barberia — tu turno cambió',
      body: [
        'Tu turno en JC Barberia fue modificado. Así queda ahora:',
        '',
        `Barbero: ${barberName}`,
        `Servicio: ${serviceName}`,
        `Fecha: ${date}`,
        `Hora: ${time}`,
        '',
        'Si no esperabas este cambio o tenés dudas, contactá al local.',
      ].join('\n'),
    };
  };
}
