import { describe, expect, it } from 'vitest';

import { FakeClock } from '../shared/ports/testing/fake-clock';
import type { Appointment } from './appointment';
import { InvalidAppointmentTransitionError } from './appointment-state-machine';
import { AppointmentNotStartedError, MarkCompletedUseCase } from './mark-completed';

/** Builds fixed instants from shop wall-clock time — the domain may not construct `Date` directly. */
const clock = new FakeClock();

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appointment-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'telefonico',
    timeRange: {
      start: clock.localTimeToUtc('2026-08-13', '10:00'),
      end: clock.localTimeToUtc('2026-08-13', '10:30'),
    },
    status: 'reservado',
    deposit: { kind: 'not_applicable' },
    ...overrides,
  };
}

/** 10:15 shop time on the appointment's own day — after it started. */
const NOW = clock.localTimeToUtc('2026-08-13', '10:15');

function buildUseCase(now: Date = NOW): MarkCompletedUseCase {
  return new MarkCompletedUseCase(new FakeClock(-180, now));
}

describe('MarkCompletedUseCase', () => {
  it('marks a telefonico turno realizado without executing any charge or refund', () => {
    // appointment-lifecycle spec, "Turno realizado sin seña previa": GIVEN
    // un turno telefónico en reservado sin seña asociada, WHEN se marca
    // realizado, THEN pasa a realizado AND no ejecuta ningún cobro ni
    // reembolso porque no había seña que aplicar.
    const appointment = buildAppointment({ status: 'reservado', deposit: { kind: 'not_applicable' } });

    const result = buildUseCase().execute({ appointment });

    expect(result.status).toBe('realizado');
    expect(result.deposit).toEqual({ kind: 'not_applicable' });
  });

  it('leaves a settled web deposit untouched — applied to the service, not refunded or charged again', () => {
    const appointment = buildAppointment({
      channel: 'web',
      status: 'reservado',
      deposit: { kind: 'settled', paymentId: 'payment-1', amountCents: 250_000 },
    });

    const result = buildUseCase().execute({ appointment });

    expect(result.status).toBe('realizado');
    expect(result.deposit).toEqual({ kind: 'settled', paymentId: 'payment-1', amountCents: 250_000 });
  });

  it('also resolves a sin_registrado turno as realizado — next-day resolution from the panel', () => {
    // sin_registrado is only reached the day AFTER the turno's own day (the
    // 23:59 sweep, README "3.5 Barrido diario de las 23:59"), so `NOW` —
    // still that same day — is already past its `timeRange.start`.
    const appointment = buildAppointment({ status: 'sin_registrado' });

    const result = buildUseCase().execute({ appointment });

    expect(result.status).toBe('realizado');
  });

  it('rejects marking a terminal turno realizado', () => {
    const appointment = buildAppointment({ status: 'cancelado' });

    expect(() => buildUseCase().execute({ appointment })).toThrow(InvalidAppointmentTransitionError);
  });

  describe('un turno no puede quedar realizado antes de haber empezado', () => {
    // Real production data showed a `reservado` turno dated 2026-09-03
    // marked `realizado` while `now` was still 2026-08-31 — the bug this
    // guard closes.
    it('rechaza marcar realizado un turno reservado cuya hora de inicio todavía no llegó', () => {
      const futureAppointment = buildAppointment({
        status: 'reservado',
        timeRange: {
          start: clock.localTimeToUtc('2026-09-03', '13:30'),
          end: clock.localTimeToUtc('2026-09-03', '14:00'),
        },
      });

      expect(() => buildUseCase().execute({ appointment: futureAppointment })).toThrow(
        AppointmentNotStartedError,
      );
    });

    it('rechaza también un turno sin_registrado cuya hora de inicio todavía no llegó', () => {
      // Defense in depth: sin_registrado should never be future-dated in
      // practice (it only exists after the day's-end sweep), but the guard
      // does not trust that invariant blindly.
      const futureAppointment = buildAppointment({
        status: 'sin_registrado',
        timeRange: {
          start: clock.localTimeToUtc('2026-09-03', '13:30'),
          end: clock.localTimeToUtc('2026-09-03', '14:00'),
        },
      });

      expect(() => buildUseCase().execute({ appointment: futureAppointment })).toThrow(
        AppointmentNotStartedError,
      );
    });

    it('permite marcar realizado apenas empieza el turno — el instante exacto de inicio ya cuenta como empezado', () => {
      const appointment = buildAppointment({
        status: 'reservado',
        timeRange: {
          start: clock.localTimeToUtc('2026-08-13', '10:00'),
          end: clock.localTimeToUtc('2026-08-13', '10:30'),
        },
      });
      // `now` equals `timeRange.start` exactly — not a millisecond into the
      // future, not a millisecond into the past.
      const useCase = buildUseCase(clock.localTimeToUtc('2026-08-13', '10:00'));

      const result = useCase.execute({ appointment });

      expect(result.status).toBe('realizado');
    });
  });
});
