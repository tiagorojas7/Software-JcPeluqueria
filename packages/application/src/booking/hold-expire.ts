import {
  AppointmentStateMachine,
  type AppointmentRepository,
  type HoldExpireViewRepository,
  type NotificationOutboxRepository,
} from '@jc-barberia/domain';
import type { RefundUseCase } from '../payments/refund';

/** What the `hold.expire` handler did for one hold. The pg-boss wiring
 *  (next slice) maps `'retry'` to a requeue-with-backoff so the 428
 *  insufficient-funds path never tight-loops; the others are terminal.
 *  `'cancelled-no-refund'` (task 12.10/12.11) is a REAL, distinct effect —
 *  the origin turno moved to `cancelado` — never collapsed into `'no-op'`,
 *  which is reserved for genuinely nothing-happened idempotent retries. */
export type ExpireHoldOutcome =
  | 'refunded-and-notified'
  | 'refunded'
  | 'cancelled-no-refund'
  | 'retry'
  | 'no-op';

/**
 * The `hold.expire` pg-boss handler, as an application-layer use case. The
 * slot liberation itself is lazy (the availability read path already frees an
 * expired, non-`payment_pending` hold), so this job — exactly as design.md
 * line 144 mandates — owns ONLY the effects that can never be lazy: refunding
 * the settled seña of the ORIGIN appointment for an absence-offer hold that
 * lapsed unconfirmed ("Hold vencido con cobro asociado") and dispatching the
 * cancellation-with-refund notification.
 *
 * Task 12.10/12.11 (barber-absence-reassignment, "Rechazo o falta de
 * respuesta cancela el turno original" — the NO-RESPONSE half) extends the
 * `origin_occupancy_id` branch: once the money side is resolved one way or
 * the other (refunded, already-refunded, or never had a deposit to begin
 * with), the ORIGIN appointment itself transitions to `cancelado` — this was
 * a real gap before: the branch refunded the seña but never actually
 * cancelled the turno it belonged to. `cancelOrigin` re-reads the origin's
 * CURRENT status and only writes when the transition is still legal
 * (`AppointmentStateMachine.canTransition`), which is what keeps a retried
 * job — or a job racing an explicit `RejectOfferUseCase` call on the same
 * origin — from ever attempting an illegal `cancelado -> cancelado`
 * double-write or clobbering a status some OTHER path already resolved.
 *
 * The cancel is deliberately skipped for `pending-insufficient-funds`: the
 * origin must never show `cancelado` while its refund is still unresolved —
 * both effects land together on whichever retry finally succeeds.
 *
 * Idempotent on retry through both the `ExpiredHoldView.isHeld` gate and
 * `RefundUseCase`'s own `already-refunded` short-circuit.
 *
 * The notification goes to the OUTBOX, never straight to `NotificationPort`
 * — the same discipline every other writer in this codebase follows. Sending
 * directly meant a transient SMTP failure threw the whole job AFTER the
 * refund had already succeeded; the pg-boss retry then hit
 * `already-refunded`, which never re-notifies. The money came back and the
 * client was never told. Delivery and its backoff belong to the outbox
 * consumer.
 */
export class ExpireHold {
  constructor(
    private readonly views: HoldExpireViewRepository,
    private readonly refund: RefundUseCase,
    private readonly outbox: NotificationOutboxRepository,
    private readonly appointments: AppointmentRepository,
  ) {}

  async execute(holdId: string): Promise<ExpireHoldOutcome> {
    const view = await this.views.loadForExpire(holdId);
    // Idempotent retry gate — the row already left `held` (confirm / rejected
    // payment / lazy liberation / a prior run resolved it, OR the client
    // accepted this exact offer via AcceptOfferUseCase, which releases the
    // hold as part of accepting): never act twice.
    if (!view || !view.isHeld) return 'no-op';
    // "Regla que elimina el peor caso" (design 150): a payment in flight is
    // never touched by the timer — it waits for ProcessPaymentUseCase's
    // terminal state.
    if (view.paymentPending) return 'no-op';
    // A plain (non-absence-offer) hold has no origin seña to refund and no
    // origin turno to cancel — the lazy read path frees its slot.
    const origin = view.originOccupancyId;
    if (!origin) return 'no-op';

    const result = await this.refund.execute({ appointmentId: origin, reason: 'hold-expired' });
    switch (result.outcome) {
      case 'refunded': {
        await this.cancelOrigin(origin);
        // The notification fires only when money moved AND the client has an
        // email registrado (notification-port spec: no email → no dispatch).
        if (view.originClientEmail) {
          await this.outbox.enqueue({
            notificationType: 'cancellation_with_refund',
            recipientEmail: view.originClientEmail,
            payload: { refundId: result.refundId, amountCents: String(result.amountCents) },
          });
          return 'refunded-and-notified';
        }
        return 'refunded';
      }
      // 428 — business state, NOT lost and NOT a tight loop: the pg-boss wiring
      // (next slice) requeues this with backoff; the notification MUST NOT fire
      // because the refund did not move. The origin stays `reservado` — it is
      // NOT cancelled until the money side actually resolves.
      case 'pending-insufficient-funds':
        return 'retry';
      // Idempotent money gate 2 — a prior run already flipped the deposit to
      // `refunded`. Still defensively attempts the cancel: a prior run could
      // have refunded and then crashed before cancelling, so this closes that
      // gap without ever risking a double notification.
      case 'already-refunded':
        await this.cancelOrigin(origin);
        return 'no-op';
      // The origin appointment had no seña (phone / walk-in) — nothing to
      // refund, but barber-absence-reassignment spec's "sin seña previa"
      // scenario still requires the cancellation itself to happen.
      case 'no-deposit':
        await this.cancelOrigin(origin);
        return 'cancelled-no-refund';
      default: {
        const _exhaustive: never = result;
        throw new Error(`ExpireHold: unhandled RefundOutcome ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  private async cancelOrigin(appointmentId: string): Promise<void> {
    const existing = await this.appointments.findById(appointmentId);
    // Already resolved through a different path (a retry that already
    // cancelled it, or a genuinely impossible state) — a silent no-op, never
    // a thrown InvalidAppointmentTransitionError from a background job.
    if (!existing || !AppointmentStateMachine.canTransition(existing.status, 'cancelado')) {
      return;
    }
    await this.appointments.updateStatus(appointmentId, 'cancelado');
  }
}
