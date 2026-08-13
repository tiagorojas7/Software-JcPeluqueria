import { describe, expect, it } from 'vitest';

import type { ActorContext } from '../access-control';
import { FakeClock } from '../shared/ports/testing/fake-clock';
import type { Appointment } from './appointment';
import { InvalidAppointmentTransitionError } from './appointment-state-machine';
import { ConfirmAbsenceUseCase, MissingActorError } from './confirm-absence';

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appointment-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'web',
    timeRange: { start: new Date('2026-08-12T13:00:00Z'), end: new Date('2026-08-12T13:30:00Z') },
    status: 'sin_registrado',
    deposit: { kind: 'settled', paymentId: 'payment-1', amountCents: 250_000 },
    ...overrides,
  };
}

const STAFF_ACTOR: ActorContext = { userId: 'staff-1', role: 'secretary' };
const NOW = new Date('2026-08-13T02:00:00Z');

function buildUseCase(): ConfirmAbsenceUseCase {
  return new ConfirmAbsenceUseCase(new FakeClock(-180, NOW));
}

describe('ConfirmAbsenceUseCase — only a human confirmation may reach ausente', () => {
  it('rejects a call with no actor — the system never infers an absence on its own', () => {
    // appointment-lifecycle spec, "El sistema nunca marca ausencias por su
    // cuenta": there must be no way to run this transition without a real
    // human actor, checked at runtime as well as by the type system.
    const appointment = buildAppointment();
    const missingActor = undefined as unknown as ActorContext;

    expect(() => buildUseCase().execute({ appointment, actor: missingActor })).toThrow(
      MissingActorError,
    );
  });

  it('rejects an actor object with no userId', () => {
    const appointment = buildAppointment();
    const emptyActor = {} as ActorContext;

    expect(() => buildUseCase().execute({ appointment, actor: emptyActor })).toThrow(
      MissingActorError,
    );
  });

  it('never allows confirming an absence directly from reservado, even with a valid actor', () => {
    // The state machine already proves canTransition('reservado', 'ausente')
    // is false; this proves the use case actually enforces it rather than
    // trusting the caller to only pass sin_registrado appointments.
    const appointment = buildAppointment({ status: 'reservado' });

    expect(() => buildUseCase().execute({ appointment, actor: STAFF_ACTOR })).toThrow(
      InvalidAppointmentTransitionError,
    );
  });
});

describe('ConfirmAbsenceUseCase — deposit resolution and absence history', () => {
  it('forfeits a settled deposit and records the absence, with a real actor', () => {
    // appointment-lifecycle spec, "Ausencia confirmada con seña": pasa a
    // ausente AND la seña queda perdida, sin reembolso.
    const appointment = buildAppointment({
      deposit: { kind: 'settled', paymentId: 'payment-1', amountCents: 250_000 },
    });

    const result = buildUseCase().execute({ appointment, actor: STAFF_ACTOR });

    expect(result.appointment.status).toBe('ausente');
    expect(result.appointment.deposit).toEqual({ kind: 'forfeited', amountCents: 250_000 });
    expect(result.absence).toEqual({
      appointmentId: 'appointment-1',
      clientId: 'client-1',
      confirmedByUserId: 'staff-1',
      confirmedAt: NOW,
      depositForfeited: true,
    });
  });

  it('confirms an absence with no deposit — no money movement, but still recorded in history', () => {
    // appointment-lifecycle spec, "Ausencia confirmada sin seña previa": no
    // ejecuta ningún movimiento de dinero, pero el evento queda registrado
    // en el historial de ausencias del cliente.
    const appointment = buildAppointment({
      channel: 'telefonico',
      deposit: { kind: 'not_applicable' },
    });

    const result = buildUseCase().execute({ appointment, actor: STAFF_ACTOR });

    expect(result.appointment.status).toBe('ausente');
    expect(result.appointment.deposit).toEqual({ kind: 'not_applicable' });
    expect(result.absence).toEqual({
      appointmentId: 'appointment-1',
      clientId: 'client-1',
      confirmedByUserId: 'staff-1',
      confirmedAt: NOW,
      depositForfeited: false,
    });
  });
});
