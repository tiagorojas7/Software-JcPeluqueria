import { describe, expect, it } from 'vitest';

import {
  AppointmentStateMachine,
  InvalidAppointmentTransitionError,
} from './appointment-state-machine';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from './appointment-status';

// README "3.2 Ciclo de vida del turno" + appointment-lifecycle spec, "Cinco
// estados explícitos y no colapsables": exactly these five edges are valid
// and nothing else — critically, there is no direct `reservado -> ausente`.
const VALID_EDGES: ReadonlyArray<readonly [AppointmentStatus, AppointmentStatus]> = [
  ['reservado', 'realizado'],
  ['reservado', 'cancelado'],
  ['reservado', 'sin_registrado'],
  ['sin_registrado', 'realizado'],
  ['sin_registrado', 'ausente'],
];

function isValidEdge(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return VALID_EDGES.some(([validFrom, validTo]) => validFrom === from && validTo === to);
}

describe('AppointmentStateMachine', () => {
  it('declares exactly the five non-collapsible states', () => {
    expect(APPOINTMENT_STATUSES).toEqual([
      'reservado',
      'realizado',
      'cancelado',
      'sin_registrado',
      'ausente',
    ]);
  });

  it('accepts every valid transition', () => {
    for (const [from, to] of VALID_EDGES) {
      expect(AppointmentStateMachine.canTransition(from, to)).toBe(true);
      expect(AppointmentStateMachine.transition(from, to)).toBe(to);
    }
  });

  it('rejects every combination that is not an explicitly valid edge', () => {
    for (const from of APPOINTMENT_STATUSES) {
      for (const to of APPOINTMENT_STATUSES) {
        if (isValidEdge(from, to)) {
          continue;
        }
        expect(AppointmentStateMachine.canTransition(from, to)).toBe(false);
        expect(() => AppointmentStateMachine.transition(from, to)).toThrow(
          InvalidAppointmentTransitionError,
        );
      }
    }
  });

  it('never allows ausente directly from reservado — only from sin_registrado', () => {
    // The crux of "el sistema nunca marca ausencias por su cuenta": even a
    // same-day, already-passed reservado turno cannot skip straight to
    // ausente. It must first become sin_registrado (the nightly sweep,
    // Phase 6), and only then can a human confirm the absence.
    expect(AppointmentStateMachine.canTransition('reservado', 'ausente')).toBe(false);
    expect(() => AppointmentStateMachine.transition('reservado', 'ausente')).toThrow(
      InvalidAppointmentTransitionError,
    );
  });

  it('treats realizado, cancelado and ausente as terminal — no outgoing edges', () => {
    for (const terminal of ['realizado', 'cancelado', 'ausente'] as const) {
      for (const to of APPOINTMENT_STATUSES) {
        expect(AppointmentStateMachine.canTransition(terminal, to)).toBe(false);
      }
    }
  });
});
