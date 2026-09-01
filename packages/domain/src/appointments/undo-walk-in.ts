import type { Appointment } from './appointment';
import { InvalidAppointmentTransitionError } from './appointment-state-machine';

/**
 * Thrown when `UndoWalkInUseCase` is asked to undo something that was never
 * a walk-in — see the class doc comment for why `channel`, not `status`, is
 * the gate.
 */
export class NotAWalkInError extends Error {
  constructor(
    readonly appointmentId: string,
    readonly channel: string,
  ) {
    super(`Appointment "${appointmentId}" was not created as a walk-in (channel "${channel}"), so there is no walk-in to undo`);
    this.name = 'NotAWalkInError';
  }
}

/**
 * The one deliberate exception to `realizado` being terminal
 * (`appointment-state-machine.ts`: "realizado ... terminal — no outgoing
 * edges"). A walk-in enters straight into `realizado` (`CreateWalkInUseCase`,
 * appointment-lifecycle spec "Los walk-ins ingresan directamente como
 * realizado") without ever passing through a human confirmation step — there
 * is no "the haircut actually happened" moment behind it the way there is for
 * a `reservado`/`sin_registrado` turno resolved through `MarkCompletedUseCase`.
 * A walk-in loaded with the wrong barber, service or time is therefore a
 * front-desk typo, not finished business, and had no way back — the bug this
 * closes.
 *
 * Scoped as narrowly as the domain allows: `channel === 'walk_in'` is the one
 * thing that distinguishes a fresh mistake from a legitimately completed
 * appointment. This deliberately does NOT add `realizado -> cancelado` to
 * `AppointmentStateMachine`'s general `VALID_TRANSITIONS` table — doing so
 * would let ANY finished appointment (a haircut that actually happened) be
 * reopened, which is exactly the "reopening finished business" this feature
 * is not meant to allow. Nothing outside this file may move a `realizado`
 * appointment back to `cancelado`.
 *
 * Deliberately takes no `PaymentPort`: a walk-in never carries a seña
 * (`CreateWalkInUseCase` always sets `deposit: { kind: 'not_applicable' }`),
 * so there is never money to resolve here — mirroring how `MarkCompletedUseCase`'s
 * signature proves it moves no money, not just happens not to.
 */
export class UndoWalkInUseCase {
  execute(appointment: Appointment): Appointment {
    if (appointment.channel !== 'walk_in') {
      throw new NotAWalkInError(appointment.id, appointment.channel);
    }
    if (appointment.status !== 'realizado') {
      throw new InvalidAppointmentTransitionError(appointment.status, 'cancelado');
    }
    return { ...appointment, status: 'cancelado' };
  }
}
