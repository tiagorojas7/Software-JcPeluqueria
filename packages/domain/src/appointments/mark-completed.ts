import type { Appointment } from './appointment';
import { AppointmentStateMachine } from './appointment-state-machine';
import { resolveDepositForCompletion } from './deposit-transitions';

export interface MarkCompletedInput {
  readonly appointment: Appointment;
}

/**
 * Marks an appointment `realizado`, valid from either `reservado` (marked
 * the same day) or `sin_registrado` (resolved the day after — README "3.5
 * Barrido diario de las 23:59"). Deliberately takes no `PaymentPort` in its
 * constructor — see `resolveDepositForCompletion` — so no deposit money can
 * move through this use case, for any deposit kind, by construction rather
 * than by convention.
 */
export class MarkCompletedUseCase {
  execute(input: MarkCompletedInput): Appointment {
    const status = AppointmentStateMachine.transition(input.appointment.status, 'realizado');
    const deposit = resolveDepositForCompletion(input.appointment.deposit);
    return { ...input.appointment, status, deposit };
  }
}
