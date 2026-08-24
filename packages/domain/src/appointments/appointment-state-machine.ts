import type { AppointmentStatus } from './appointment-status';

export class InvalidAppointmentTransitionError extends Error {
  constructor(
    readonly from: AppointmentStatus,
    readonly to: AppointmentStatus,
  ) {
    super(`Cannot transition an appointment from "${from}" to "${to}"`);
    this.name = 'InvalidAppointmentTransitionError';
  }
}

/**
 * The five states and their valid transitions, straight from the README's
 * "3.2 Ciclo de vida del turno" diagram and the appointment-lifecycle spec.
 * `realizado`, `cancelado` and `ausente` are terminal — no outgoing edges.
 *
 * `ausente` has exactly ONE incoming edge, from `sin_registrado` — never
 * from `reservado` directly. That single edge is what makes "the system
 * never marks an absence on its own" a structural guarantee rather than a
 * convention: nothing here lets a same-day `reservado` turno become
 * `ausente` without first passing through the unattended state the nightly
 * sweep (Phase 6) produces, and even then only `ConfirmAbsenceUseCase` —
 * which requires a real human `ActorContext` — ever requests that edge.
 */
const VALID_TRANSITIONS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  reservado: ['realizado', 'cancelado', 'sin_registrado'],
  sin_registrado: ['realizado', 'ausente'],
  realizado: [],
  cancelado: [],
  ausente: [],
};

/**
 * Pure, stateless transition rules — no dependencies, hence static methods
 * rather than an object nobody needs to instantiate.
 */
export class AppointmentStateMachine {
  static canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
    return VALID_TRANSITIONS[from].includes(to);
  }

  /**
   * Whether the appointment has reached a state with no outgoing edges —
   * `realizado`, `cancelado` and `ausente`. Derived from the same
   * `VALID_TRANSITIONS` table the transitions themselves read, so a future
   * edge added there is reflected here for free and the two can never drift.
   *
   * Callers that decide what a human may still DO with an appointment (the
   * day board's `allowedActions`) ask this instead of listing terminal
   * states again: the lifecycle is defined once, in this file.
   */
  static isTerminal(status: AppointmentStatus): boolean {
    return VALID_TRANSITIONS[status].length === 0;
  }

  static transition(from: AppointmentStatus, to: AppointmentStatus): AppointmentStatus {
    if (!AppointmentStateMachine.canTransition(from, to)) {
      throw new InvalidAppointmentTransitionError(from, to);
    }
    return to;
  }
}
