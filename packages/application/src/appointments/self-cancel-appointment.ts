import {
  AppointmentStateMachine,
  resolveDepositForCancellation,
  type Appointment,
  type AppointmentRepository,
  type Clock,
  type PaymentPort,
} from '@jc-barberia/domain';

/**
 * How long before the appointment self-service cancellation closes.
 * client-booking spec: "hasta 1 hora antes de la hora del turno". The 2-hour
 * reminder (notification-port) announces this same cutoff as the client's last
 * chance, so both must read the same number — hence a shared constant rather
 * than a literal in each place.
 */
export const SELF_CANCEL_WINDOW_MINUTES = 60;

export interface SelfCancelInput {
  readonly appointmentId: string;
  /** The authenticated client's own id, resolved by the endpoint from the
   *  session (`users.client_id`). Never taken from the request body. */
  readonly clientId: string;
}

export type SelfCancelResult =
  | { readonly outcome: 'cancelled'; readonly appointment: Appointment }
  | { readonly outcome: 'too-late'; readonly cutoff: Date }
  | { readonly outcome: 'not-yours' }
  | { readonly outcome: 'not-cancellable' };

/**
 * The client's own cancellation (client-booking spec, "Cancelación del cliente
 * con reembolso automático" + "El cliente solo actúa sobre sus propios datos").
 *
 * Sibling of `AdminCancelAppointmentUseCase`, with two constraints staff do not
 * have: the appointment must belong to the caller, and the 1-hour window must
 * still be open. Past that cutoff the row is not frozen — an administrator can
 * still cancel it through the admin use case; what closes is *self-service*,
 * which is what the requirement restricts.
 *
 * Rejections are returned, not thrown: "too late" and "not yours" are ordinary
 * outcomes of a client clicking a stale page, not exceptional conditions. Only
 * a genuine programming error (an impossible deposit state) still throws, via
 * `resolveDepositForCancellation`.
 */
export class SelfCancelAppointmentUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly paymentPort: PaymentPort,
    private readonly clock: Clock,
  ) {}

  async execute(input: SelfCancelInput): Promise<SelfCancelResult> {
    const existing = await this.appointments.findById(input.appointmentId);

    // Ownership is checked FIRST, and a missing appointment is answered
    // identically to someone else's. Checking the window first would let a
    // prober separate "exists and starts soon" from "not yours" — a timing
    // oracle over other people's appointments. The client learns nothing about
    // rows that are not theirs, including whether they exist.
    if (!existing || existing.clientId !== input.clientId) {
      return { outcome: 'not-yours' };
    }

    if (!AppointmentStateMachine.canTransition(existing.status, 'cancelado')) {
      return { outcome: 'not-cancellable' };
    }

    const cutoff = this.clock.addMinutes(existing.timeRange.start, -SELF_CANCEL_WINDOW_MINUTES);
    if (this.clock.now() > cutoff) {
      return { outcome: 'too-late', cutoff };
    }

    const status = AppointmentStateMachine.transition(existing.status, 'cancelado');
    // The refund is part of cancelling, not a follow-up step: the requirement
    // says "sin aprobación manual". `resolveDepositForCancellation` owns the
    // exhaustive `DepositState` switch, so the no-deposit phone case cannot be
    // forgotten here.
    const deposit = await resolveDepositForCancellation(existing.deposit, this.paymentPort);
    await this.appointments.updateStatus(input.appointmentId, status);

    return { outcome: 'cancelled', appointment: { ...existing, status, deposit } };
  }
}
