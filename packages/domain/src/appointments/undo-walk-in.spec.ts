import { describe, expect, it } from 'vitest';

import { FakeClock } from '../shared/ports/testing/fake-clock';
import type { Appointment } from './appointment';
import { InvalidAppointmentTransitionError } from './appointment-state-machine';
import { NotAWalkInError, UndoWalkInUseCase } from './undo-walk-in';

/** Builds fixed instants from shop wall-clock time — the domain may not construct `Date` directly. */
const clock = new FakeClock();

function buildWalkIn(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'walk-in-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: null,
    channel: 'walk_in',
    timeRange: {
      start: clock.localTimeToUtc('2026-08-13', '10:00'),
      end: clock.localTimeToUtc('2026-08-13', '10:30'),
    },
    status: 'realizado',
    deposit: { kind: 'not_applicable' },
    ...overrides,
  };
}

describe('UndoWalkInUseCase', () => {
  // The escape hatch this closes: a walk-in loaded into `realizado` by
  // mistake used to be stuck forever — `realizado` has no outgoing edges in
  // `AppointmentStateMachine`. This is the one narrow exception, gated on
  // `channel === 'walk_in'` rather than a new general transition, so a
  // legitimately completed appointment is never affected.
  it('undoes a walk-in loaded by mistake, sending it to cancelado', () => {
    const walkIn = buildWalkIn();

    const result = new UndoWalkInUseCase().execute(walkIn);

    expect(result.status).toBe('cancelado');
  });

  it('leaves the deposit untouched — a walk-in never carries a seña to resolve', () => {
    const walkIn = buildWalkIn();

    const result = new UndoWalkInUseCase().execute(walkIn);

    expect(result.deposit).toEqual({ kind: 'not_applicable' });
  });

  // The whole point: a normal appointment that ran its course and reached
  // `realizado` through `reservado`/`sin_registrado` is finished business,
  // not a mistake to correct. `channel` is what tells the two apart —
  // never the status alone.
  it('refuses a NON-walk-in realizado turno — a completed appointment is not a mistake to undo', () => {
    const completed = buildWalkIn({ channel: 'telefonico', clientId: 'client-1' });

    expect(() => new UndoWalkInUseCase().execute(completed)).toThrow(NotAWalkInError);
  });

  it('refuses a walk-in that already left realizado — nothing left to undo', () => {
    const alreadyCancelled = buildWalkIn({ status: 'cancelado' });

    expect(() => new UndoWalkInUseCase().execute(alreadyCancelled)).toThrow(InvalidAppointmentTransitionError);
  });
});
