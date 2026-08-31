import type { ActorContext } from '../access-control';
import type { Clock } from '../shared/ports/clock.port';
import type { AbsenceRecord } from './absence-record';
import type { Appointment } from './appointment';
import { AppointmentStateMachine } from './appointment-state-machine';
import { resolveDepositForAbsence } from './deposit-transitions';

export class MissingActorError extends Error {
  constructor() {
    super('Confirming an absence requires a real human ActorContext — the system never infers one');
    this.name = 'MissingActorError';
  }
}

export interface ConfirmAbsenceInput {
  readonly appointment: Appointment;
  /**
   * The staff member confirming the no-show. Required, never optional or
   * defaulted — appointment-lifecycle spec, "El sistema nunca marca
   * ausencias por su cuenta": only an explicit human confirmation may reach
   * this transition. Checked at runtime too (not just by the type system),
   * so a caller that bypasses TypeScript still cannot slip an empty actor
   * through.
   */
  readonly actor: ActorContext;
}

export interface ConfirmAbsenceResult {
  readonly appointment: Appointment;
  readonly absence: AbsenceRecord;
}

/**
 * The only function in this codebase that may move an appointment into
 * `ausente`. Two independent guards back this: the state machine only
 * allows that edge from `sin_registrado` (see
 * `appointment-state-machine.ts`), and this use case refuses to run without
 * a real `actor` — so nothing, scheduled job or otherwise, can trigger an
 * absence automatically.
 */
export class ConfirmAbsenceUseCase {
  constructor(private readonly clock: Clock) {}

  execute(input: ConfirmAbsenceInput): ConfirmAbsenceResult {
    if (!input.actor?.userId) {
      throw new MissingActorError();
    }

    const status = AppointmentStateMachine.transition(input.appointment.status, 'ausente');
    const deposit = resolveDepositForAbsence(input.appointment.deposit);
    const appointment: Appointment = { ...input.appointment, status, deposit };
    const absence: AbsenceRecord = {
      appointmentId: input.appointment.id,
      // `ausente` is reachable only from `sin_registrado`, itself reachable
      // only from `reservado` (appointment-state-machine.ts's
      // `VALID_TRANSITIONS`) — a walk-in never visits either state, it enters
      // straight into `realizado` and stays there (appointment-lifecycle
      // spec). An appointment that legitimately reaches this use case always
      // carries a real client.
      clientId: input.appointment.clientId!,
      confirmedByUserId: input.actor.userId,
      confirmedAt: this.clock.now(),
      depositForfeited: deposit.kind === 'forfeited',
    };
    return { appointment, absence };
  }
}
