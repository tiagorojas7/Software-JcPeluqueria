import { describe, expect, it } from 'vitest';

import type { Appointment } from './appointment';
import { InvalidAppointmentTransitionError } from './appointment-state-machine';
import { MarkCompletedUseCase } from './mark-completed';

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appointment-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'telefonico',
    timeRange: { start: new Date('2026-08-13T13:00:00Z'), end: new Date('2026-08-13T13:30:00Z') },
    status: 'reservado',
    deposit: { kind: 'not_applicable' },
    ...overrides,
  };
}

describe('MarkCompletedUseCase', () => {
  it('marks a telefonico turno realizado without executing any charge or refund', () => {
    // appointment-lifecycle spec, "Turno realizado sin seña previa": GIVEN
    // un turno telefónico en reservado sin seña asociada, WHEN se marca
    // realizado, THEN pasa a realizado AND no ejecuta ningún cobro ni
    // reembolso porque no había seña que aplicar.
    const appointment = buildAppointment({ status: 'reservado', deposit: { kind: 'not_applicable' } });

    const result = new MarkCompletedUseCase().execute({ appointment });

    expect(result.status).toBe('realizado');
    expect(result.deposit).toEqual({ kind: 'not_applicable' });
  });

  it('leaves a settled web deposit untouched — applied to the service, not refunded or charged again', () => {
    const appointment = buildAppointment({
      channel: 'web',
      status: 'reservado',
      deposit: { kind: 'settled', paymentId: 'payment-1', amountCents: 250_000 },
    });

    const result = new MarkCompletedUseCase().execute({ appointment });

    expect(result.status).toBe('realizado');
    expect(result.deposit).toEqual({ kind: 'settled', paymentId: 'payment-1', amountCents: 250_000 });
  });

  it('also resolves a sin_registrado turno as realizado — next-day resolution from the panel', () => {
    const appointment = buildAppointment({ status: 'sin_registrado' });

    const result = new MarkCompletedUseCase().execute({ appointment });

    expect(result.status).toBe('realizado');
  });

  it('rejects marking a terminal turno realizado', () => {
    const appointment = buildAppointment({ status: 'cancelado' });

    expect(() => new MarkCompletedUseCase().execute({ appointment })).toThrow(
      InvalidAppointmentTransitionError,
    );
  });
});
