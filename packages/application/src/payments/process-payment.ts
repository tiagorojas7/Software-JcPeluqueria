import type {
  Appointment,
  AppointmentRepository,
  BarberRepository,
  ClientRepository,
  DepositRepository,
  NotificationOutboxRepository,
  PaymentPort,
  PaymentStatus,
  RecordSettledPaymentResult,
  ReleaseRejectedPaymentResult,
  ServiceRepository,
} from '@jc-barberia/domain';

import type { ScheduleAppointmentReminder } from '../booking/appointment-reminder';

export type ProcessPaymentResult =
  | { readonly outcome: Exclude<RecordSettledPaymentResult, 'hold-not-found'> }
  /** An approved payment whose hold could not be claimed (already reservado
   *  through another payment, or released): the charge was given back in
   *  full. `hold-not-found` itself never escapes this use case. */
  | { readonly outcome: 'orphaned-payment-refunded' }
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
 *
 * cablear-el-mvp item 1: the SAME 'confirmed' branch, for the SAME
 * idempotency reason, also enqueues the `booking_confirmed` notification —
 * the ONLY message a client who paid online gets before the 2h reminder.
 * Written to `NotificationOutboxRepository` (never `NotificationPort`
 * directly), the same transactional-outbox pattern
 * `GenerateAbsenceReassignmentOffers` already established, gated on the
 * client having an email registrado — same gate `AppointmentReminder`
 * already uses: no email, no dispatch, never a crash.
 */
export class ProcessPaymentUseCase {
  constructor(
    private readonly paymentPort: PaymentPort,
    private readonly deposits: DepositRepository,
    private readonly appointments: AppointmentRepository,
    private readonly scheduleReminder: ScheduleAppointmentReminder,
    private readonly outbox: NotificationOutboxRepository,
    private readonly clients: ClientRepository,
    private readonly barbers: BarberRepository,
    private readonly services: ServiceRepository,
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
          await this.notifyBookingConfirmed(appointment);
        }
        return { outcome };
      }
      if (outcome === 'hold-not-found') {
        // Real money was captured for a hold this payment can no longer
        // claim — checkout has no per-hold lock, so a second preference for
        // the same hold can get paid too, and expired holds can settle late.
        // `recordSettledPayment` rolled its deposit insert back, so nothing
        // links this charge to any turno: give it back, in full, NOW. A
        // throwing refund (gateway down, 428) propagates on purpose —
        // pg-boss retries the whole job, the claim fails the same way, and
        // the refund is attempted again; the adapter treats MercadoPago's
        // "already refunded" as success, so a crash after a successful
        // refund retries into a no-op, never a double give-back.
        await this.paymentPort.refund({
          paymentId: payment.paymentId,
          amountCents: payment.amountCents,
        });
        return { outcome: 'orphaned-payment-refunded' };
      }
      return { outcome };
    }

    if (payment.status === 'rejected' || payment.status === 'cancelled') {
      const outcome = await this.deposits.releaseHoldOnRejectedPayment(payment.externalReference);
      return { outcome, status: payment.status };
    }

    return { outcome: 'ignored', status: payment.status };
  }

  /** notification-port spec's email gate: no email registrado, no dispatch,
   *  never a crash — the hold/turno itself is confirmed regardless of
   *  whether this fires. Barber/service names default to '' on a dangling
   *  id rather than throwing, matching `notifyClient` in
   *  `GenerateAbsenceReassignmentOffers`'s own "never crash the confirmation
   *  path over a notification" posture. */
  private async notifyBookingConfirmed(appointment: Appointment): Promise<void> {
    // A walk-in never carries a settled deposit (it is never web-booked), so
    // this path never actually meets one — but `clientId` is nullable on
    // `Appointment` in general, and a missing client is the same no-op a
    // missing email already is.
    const client = appointment.clientId ? await this.clients.findById(appointment.clientId) : null;
    if (!client || !client.email) {
      return;
    }
    const [barber, service] = await Promise.all([
      this.barbers.findById(appointment.barberId),
      this.services.findById(appointment.serviceId),
    ]);
    await this.outbox.enqueue({
      notificationType: 'booking_confirmed',
      recipientEmail: client.email,
      payload: {
        appointmentId: appointment.id,
        barberName: barber?.name ?? '',
        serviceName: service?.name ?? '',
        appointmentTime: appointment.timeRange.start.toISOString(),
      },
    });
  }
}
