import type {
  AppointmentRepository,
  DepositRepository,
  PaymentPort,
  PaymentStatus,
  RecordSettledPaymentResult,
  ReleaseRejectedPaymentResult,
} from '@jc-barberia/domain';

import type { ScheduleAppointmentReminder } from '../booking/appointment-reminder';

export type ProcessPaymentResult =
  | { readonly outcome: RecordSettledPaymentResult }
  | { readonly outcome: ReleaseRejectedPaymentResult; readonly status: 'rejected' | 'cancelled' }
  | { readonly outcome: 'ignored'; readonly status: PaymentStatus };

/**
 * This IS "the worker" design.md describes: it never trusts the webhook
 * payload or the browser redirect, only `PaymentPort.getPayment()`'s own
 * answer. Enqueuing/consuming via pg-boss (Phase 6) is orthogonal to this
 * logic — whatever calls `execute(paymentId)` plays that role.
 *
 * Three branches, matching MercadoPago's own terminal/non-terminal split:
 *   - `approved`     → record the settled deposit, flip the hold to reservado
 *   - `rejected` /
 *     `cancelled`    → terminal failure: release the hold NOW, do not wait
 *                      the 15 min (design.md line 152). Idempotent — a retried
 *                      webhook reports `no-op` for a hold already released.
 *   - `pending` /
 *     `in_process`   → not terminal: the payment can still flip to approved,
 *                      so the hold stays put (the 5.18 fix keeps the timer off
 *                      it) and this is a plain no-op.
 *
 * E.2 (cablear-el-mvp Slice E): a web booking's appointment only becomes
 * `reservado` on the FIRST `'confirmed'` outcome — this is the other
 * producer `ScheduleAppointmentReminder` needs (`CreatePhoneAppointmentUseCase`
 * is the other, for the no-deposit phone path). Scheduled only on
 * `'confirmed'`, never on `'already-processed'`: a retried webhook must not
 * enqueue a second reminder job for the same appointment. The appointment is
 * re-read here rather than trusted from the payment payload, the same
 * "re-read, don't trust a snapshot" discipline `appointment.reminder`'s own
 * handler already applies at fire time.
 */
export class ProcessPaymentUseCase {
  constructor(
    private readonly paymentPort: PaymentPort,
    private readonly deposits: DepositRepository,
    private readonly appointments: AppointmentRepository,
    private readonly scheduleReminder: ScheduleAppointmentReminder,
  ) {}

  async execute(paymentId: string): Promise<ProcessPaymentResult> {
    const payment = await this.paymentPort.getPayment(paymentId);
    if (payment.status === 'approved') {
      const outcome = await this.deposits.recordSettledPayment({
        holdId: payment.externalReference,
        paymentId: payment.paymentId,
        amountCents: payment.amountCents,
      });
      if (outcome === 'confirmed') {
        const appointment = await this.appointments.findById(payment.externalReference);
        if (appointment) {
          await this.scheduleReminder.execute({
            appointmentId: appointment.id,
            appointmentStart: appointment.timeRange.start,
          });
        }
      }
      return { outcome };
    }

    if (payment.status === 'rejected' || payment.status === 'cancelled') {
      const outcome = await this.deposits.releaseHoldOnRejectedPayment(payment.externalReference);
      return { outcome, status: payment.status };
    }

    return { outcome: 'ignored', status: payment.status };
  }
}
