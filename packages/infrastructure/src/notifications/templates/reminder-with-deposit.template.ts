import type { Clock } from '@jc-barberia/domain';

import type { EmailTemplateRenderer } from './types';

/**
 * "Recordatorio de un turno con seña" — the con-seña branch of the
 * DepositState fork. MUST two things (notification-port spec: "El recordatorio
 * informa la última oportunidad"):
 *   - say explicitly it is the LAST chance to cancel and recover the seña, and
 *   - show the EXACT cutoff the client has: the turno's start minus 1 hour, in
 *     the shop's own wall clock (never UTC — a customer reads shop time).
 * The cutoff is `Clock.addMinutes(parseInstant(appointmentTime), -60)`, rendered
 * via `Clock.wallClockTimeOf`. Both Clock calls are the ONLY offset math here:
 * the template never reads `SHOP_UTC_OFFSET` or builds a `Date` directly — the
 * `no-restricted-syntax` lint rule forbids that outside ShopClock/FakeClock.
 *
 * The payload is `{ appointmentId, appointmentTime }` (the ISO the
 * `appointment.reminder` handler wrote to the outbox in 6.10/6.11). The reminder
 * fires 2h before the turno, so the margin between the reminder and the cutoff
 * is ~1h — matching the cancel-refund window of `client-booking`.
 */
export function createReminderWithDepositTemplate(clock: Clock): EmailTemplateRenderer {
  return ({ appointmentId = '', appointmentTime = '' }) => {
    const appointmentDate = clock.parseInstant(appointmentTime);
    const cutoff = clock.addMinutes(appointmentDate, -60);
    const cutoffTime = clock.wallClockTimeOf(cutoff);
    return {
      subject: 'JC Barberia — última oportunidad: recordatorio de tu turno con seña',
      body: [
        'Te recordamos tu turno en JC Barberia.',
        '',
        'Esta es la última oportunidad para cancelar y recuperar tu seña.',
        `Podés cancelar hasta las ${cutoffTime} (una hora antes del turno).`,
        '',
        `(Turno ${appointmentId} — ${appointmentTime})`,
      ].join('\n'),
    };
  };
}
