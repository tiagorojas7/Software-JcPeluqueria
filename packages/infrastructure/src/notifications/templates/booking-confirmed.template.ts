import type { Clock } from '@jc-barberia/domain';

import type { EmailTemplateRenderer } from './types';

/**
 * "Turno confirmado" — fired by `ProcessPaymentUseCase` the first time a
 * web booking's deposit settles (cablear-el-mvp item 1). Until this
 * template existed a client who paid online heard nothing at all. The
 * payload is `{ appointmentId, barberName, serviceName, appointmentTime }`
 * (all strings, the outbox payload is a flat `Record<string, string>`).
 * `appointmentTime` renders through `Clock` (`parseInstant` +
 * `calendarDateOf` + `wallClockTimeOf`), never a raw ISO string or a `Date`
 * built directly — the same discipline every other template in this
 * directory already follows, so a customer always reads shop-local time.
 */
export function createBookingConfirmedTemplate(clock: Clock): EmailTemplateRenderer {
  return ({ barberName = '', serviceName = '', appointmentTime = '', depositPaid = 'true' }) => {
    const start = clock.parseInstant(appointmentTime);
    const date = clock.calendarDateOf(start);
    const time = clock.wallClockTimeOf(start);
    // Whether a deposit was actually paid is a fact of the booking, never an
    // assumption of the template. A phone booking carries no deposit
    // (admin-operations: "turnos telefónicos sin seña"), and this message used
    // to tell those clients "Ya pagaste la seña" — asserting a payment that
    // never happened, which is worse than saying nothing about money at all.
    // Defaults to `'true'` so the web path, whose deposit HAS settled by the
    // time this fires, keeps reading exactly as before.
    const moneyLine =
      depositPaid === 'true'
        ? 'Ya pagaste la seña. El resto del precio se paga en el local, el dia del turno.'
        : 'Este turno no lleva seña: el precio completo se paga en el local, el dia del turno.';
    return {
      subject: 'JC Barberia — turno confirmado',
      body: [
        'Confirmamos tu turno en JC Barberia.',
        '',
        `Barbero: ${barberName}`,
        `Servicio: ${serviceName}`,
        `Fecha: ${date}`,
        `Hora: ${time}`,
        '',
        moneyLine,
        '',
        'Si necesitas cancelar, podes hacerlo desde "Mi cuenta" respetando la ventana permitida.',
      ].join('\n'),
    };
  };
}
