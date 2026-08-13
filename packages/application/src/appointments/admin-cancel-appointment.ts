import {
  AppointmentNotFoundError,
  AppointmentStateMachine,
  resolveDepositForCancellation,
  type Appointment,
  type AppointmentRepository,
  type PaymentPort,
} from '@jc-barberia/domain';

/**
 * Administrative cancellation (admin-operations spec, "Edición y
 * cancelación administrativa"): refunds automatically when the appointment
 * carries a settled deposit, does nothing money-wise otherwise. This is
 * `resolveDepositForCancellation`'s first real consumer (Phase 4 built it,
 * "no está conectado a ningún CancelUseCase todavía") — the exhaustive
 * `DepositState` switch inside it is exactly what makes the `not_applicable`
 * branch (the phone-booking majority during the paper transition) a case
 * this use case cannot forget to handle, rather than an `if` someone omits.
 */
export class AdminCancelAppointmentUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly paymentPort: PaymentPort,
  ) {}

  async execute(appointmentId: string): Promise<Appointment> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) {
      throw new AppointmentNotFoundError(appointmentId);
    }

    const status = AppointmentStateMachine.transition(existing.status, 'cancelado');
    const deposit = await resolveDepositForCancellation(existing.deposit, this.paymentPort);
    await this.appointments.updateStatus(appointmentId, status);

    return { ...existing, status, deposit };
  }
}
