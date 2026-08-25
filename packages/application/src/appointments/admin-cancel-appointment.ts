import {
  AppointmentNotFoundError,
  AppointmentStateMachine,
  resolveDepositForCancellation,
  resolveDepositForLateCancellation,
  type Appointment,
  type AppointmentRepository,
  type Clock,
  type PaymentPort,
} from '@jc-barberia/domain';

import { SELF_CANCEL_WINDOW_MINUTES } from './self-cancel-appointment';

/**
 * Administrative cancellation (admin-operations spec, "Edición y
 * cancelación administrativa"): releases the turno and resolves the money.
 * This is `resolveDepositForCancellation`'s first real consumer (Phase 4
 * built it, "no está conectado a ningún CancelUseCase todavía") — the
 * exhaustive `DepositState` switch inside it is exactly what makes the
 * `not_applicable` branch (the phone-booking majority during the paper
 * transition) a case this use case cannot forget to handle, rather than an
 * `if` someone omits.
 *
 * The money rule is the SAME one `SelfCancelAppointmentUseCase` applies to
 * the client's own cancellation, and shares its constant: the seña comes
 * back up to `SELF_CANCEL_WINDOW_MINUTES` before the turno, and is forfeited
 * after that. It is one rule about one turno, so cancelling it from the
 * counter and cancelling it from "Mi cuenta" cannot mean two different
 * things to the client's money.
 *
 * This use case used to refund unconditionally, which was wrong in both
 * directions: it handed back a seña the shop had already earned on a
 * last-minute cancellation, and it fired a real MercadoPago refund for
 * turnos where no refund was due at all — so a gateway rejection could block
 * a cancellation that never needed the gateway in the first place.
 */
export class AdminCancelAppointmentUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly paymentPort: PaymentPort,
    private readonly clock: Clock,
  ) {}

  async execute(appointmentId: string): Promise<Appointment> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) {
      throw new AppointmentNotFoundError(appointmentId);
    }

    const status = AppointmentStateMachine.transition(existing.status, 'cancelado');

    // The window decides what happens to the MONEY, never whether the panel
    // may cancel — same wording, same cutoff and same inclusive comparison as
    // `SelfCancelAppointmentUseCase`. Either branch owns the exhaustive
    // `DepositState` switch, so the no-deposit phone case cannot be forgotten.
    const cutoff = this.clock.addMinutes(existing.timeRange.start, -SELF_CANCEL_WINDOW_MINUTES);
    const withinWindow = this.clock.now() <= cutoff;
    const deposit = withinWindow
      ? await resolveDepositForCancellation(existing.deposit, this.paymentPort)
      : resolveDepositForLateCancellation(existing.deposit);

    await this.appointments.updateStatus(appointmentId, status);

    return { ...existing, status, deposit };
  }
}
