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
