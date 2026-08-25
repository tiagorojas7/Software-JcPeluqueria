import { FakeClock } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { createTemplateRegistry } from './index';

// 7.9 / 7.10 — notification-port: "El recordatorio informa la última
// oportunidad de cancelar." Two RED branches against the current generic
// reminder (still in place from 7.8):
//   - con seña: MUST say "última oportunidad" AND show the exact cutoff
//     (hora del turno − 1h), shop-local. The generic reminder has neither.
//   - sin seña: MUST NOT mention any seña. The generic reminder mentions one.
// 7.11 GREEN splits the reminder by DepositState into the two variants the
// spec describes, taking a `Clock` to compute the cutoff.

// Shop offset is -03:00 (Argentina), so 2026-09-01T16:00:00.000Z is 13:00
// shop-local and its "turno − 1h" cutoff the spec wants rendered is 12:00.
const APPOINTMENT_13H_LOCAL_UTC = '2026-09-01T16:00:00.000Z';
const CUTOFF_12H_LOCAL = '12:00';

describe('reminder condicional por DepositState (7.9/7.10/7.11)', () => {
  const registry = createTemplateRegistry(new FakeClock());

  it('7.9 — con seña: menciona "última oportunidad" y la hora exacta de corte (turno − 1h)', () => {
    const rendered = registry['reminder_with_deposit']({
      appointmentId: 'apt-1',
      appointmentTime: APPOINTMENT_13H_LOCAL_UTC,
    });

    expect(rendered.body).toContain('última oportunidad');
    expect(rendered.body).toContain(CUTOFF_12H_LOCAL);
  });

  it('7.10 — sin seña: no menciona ninguna seña ni última oportunidad', () => {
    const rendered = registry['reminder_without_deposit']({
      appointmentId: 'apt-1',
      appointmentTime: APPOINTMENT_13H_LOCAL_UTC,
    });

    expect(rendered.body).not.toMatch(/seña|sena/i);
    expect(rendered.body).not.toContain('última oportunidad');
  });
});

// RED — reported from the real inbox: the reminder that reaches the client
// says `(Turno 4a18d65e-d246-4cd8-87d7-aafedc4bd939 — 2026-08-26T12:00:00.000Z)`.
// That is a database id and a UTC instant: the two things a customer can do
// nothing with. What a reminder is FOR is telling somebody what they booked
// and when — barbero, servicio, fecha y hora del local — which is exactly
// what `booking_confirmed` has always rendered correctly right next to it.
describe('el recordatorio dice QUE turno es, no su id', () => {
  const registry = createTemplateRegistry(new FakeClock());
  const payload = {
    appointmentId: 'apt-1',
    appointmentTime: APPOINTMENT_13H_LOCAL_UTC,
    barberName: 'Cristian Gómez',
    serviceName: 'Corte clásico',
  };

  for (const template of ['reminder_with_deposit', 'reminder_without_deposit'] as const) {
    it(`${template}: muestra barbero, servicio, fecha y hora del local`, () => {
      const rendered = registry[template](payload);

      expect(rendered.body).toContain('Cristian Gómez');
      expect(rendered.body).toContain('Corte clásico');
      expect(rendered.body).toContain('2026-09-01');
      expect(rendered.body).toContain('13:00');
    });

    it(`${template}: no muestra el id del turno ni el instante UTC crudo`, () => {
      const rendered = registry[template](payload);

      expect(rendered.body).not.toContain('apt-1');
      expect(rendered.body).not.toContain(APPOINTMENT_13H_LOCAL_UTC);
    });
  }

  // A dangling barber/service id must never cost the client their reminder —
  // same posture `booking_confirmed` takes.
  it('renderiza igual cuando falta el nombre del barbero o del servicio', () => {
    const rendered = registry['reminder_with_deposit']({
      appointmentId: 'apt-1',
      appointmentTime: APPOINTMENT_13H_LOCAL_UTC,
    });

    expect(rendered.body).toContain('13:00');
    expect(rendered.body).toContain('última oportunidad');
  });
});
