import {
  AppointmentStateMachine,
  resolveDepositForCancellation,
  type Appointment,
  type AppointmentRepository,
  type PaymentPort,
} from '@jc-barberia/domain';

export interface RejectOfferInput {
  readonly originalAppointmentId: string;
}

export type RejectOfferResult =
  | { readonly outcome: 'cancelled'; readonly appointment: Appointment }
  | { readonly outcome: 'not-cancellable' };

/**
 * barber-absence-reassignment spec, "Rechazo o falta de respuesta cancela
 * el turno original" — the explicit-rejection half (the client actively
 * declined every offer). Sibling of `AdminCancelAppointmentUseCase`: same
 * `resolveDepositForCancellation` (Phase 4) refund-if-settled/no-op-if-not
 * shape, reused rather than reinvented, so the exhaustive `DepositState`
 * switch that already protects every other cancellation path protects this
 * one too. The "no responde en 15 minutos" half of this same requirement is
 * NOT here — that is `ExpireHold`'s extended `origin_occupancy_id` branch
 * (task 12.10/12.11), triggered by the hold's own expiry job instead of a
 * human action.
 */
export class RejectOfferUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly paymentPort: PaymentPort,
  ) {}

  async execute(input: RejectOfferInput): Promise<RejectOfferResult> {
    const existing = await this.appointments.findById(input.originalAppointmentId);
    if (!existing || !AppointmentStateMachine.canTransition(existing.status, 'cancelado')) {
      return { outcome: 'not-cancellable' };
    }

    const status = AppointmentStateMachine.transition(existing.status, 'cancelado');
    // The refund is part of rejecting, not a follow-up step — same ordering
    // decision `AdminCancelAppointmentUseCase` already made: resolve the
    // deposit BEFORE persisting the status, so a caller reading the
    // returned `Appointment` never observes `cancelado` with a still-settled
    // seña, even momentarily.
    const deposit = await resolveDepositForCancellation(existing.deposit, this.paymentPort);
    await this.appointments.updateStatus(input.originalAppointmentId, status);

    return { outcome: 'cancelled', appointment: { ...existing, status, deposit } };
  }
}
