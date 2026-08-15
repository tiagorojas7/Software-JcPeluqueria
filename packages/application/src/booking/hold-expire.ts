import type { HoldExpireViewRepository, NotificationPort } from '@jc-barberia/domain';
import type { RefundUseCase } from '../payments/refund';

/** What the `hold.expire` handler did for one hold. The pg-boss wiring
 *  (next slice) maps `'retry'` to a requeue-with-backoff so the 428
 *  insufficient-funds path never tight-loops; the others are terminal. */
export type ExpireHoldOutcome =
  | 'refunded-and-notified'
  | 'refunded'
  | 'retry'
  | 'no-op';

/**
 * The `hold.expire` pg-boss handler, as an application-layer use case. The
 * slot liberation itself is lazy (the availability read path already frees an
 * expired, non-`payment_pending` hold), so this job — exactly as design.md
 * line 144 mandates — owns ONLY the effects that can never be lazy: refunding
 * the settled seña of the ORIGIN appointment for an absence-offer hold that
 * lapsed unconfirmed ("Hold vencido con cobro asociado") and dispatching the
 * cancellation-with-refund notification. Idempotent on retry through both
 * the `ExpiredHoldView.isHeld` gate and `RefundUseCase`'s own
 * `already-refunded` short-circuit. Phase 12 (12.11) extends the
 * `origin_occupancy_id` branch for the no-seña sub-case + `RejectOfferUseCase`.
 */
export class ExpireHold {
  constructor(
    private readonly views: HoldExpireViewRepository,
    private readonly refund: RefundUseCase,
    private readonly notifications: NotificationPort,
  ) {}

  async execute(holdId: string): Promise<ExpireHoldOutcome> {
    const view = await this.views.loadForExpire(holdId);
    // Idempotent retry gate — the row already left `held` (confirm / rejected
    // payment / lazy liberation / a prior run resolved it): never act twice.
    if (!view || !view.isHeld) return 'no-op';
    // "Regla que elimina el peor caso" (design 150): a payment in flight is
    // never touched by the timer — it waits for ProcessPaymentUseCase's
    // terminal state.
    if (view.paymentPending) return 'no-op';
    // A plain (non-absence-offer) hold has no origin seña to refund and no
    // cancellation-with-refund to send — the lazy read path frees its slot;
    // Phase 12 owns the no-seña origin sub-case and RejectOfferUseCase.
    const origin = view.originOccupancyId;
    if (!origin) return 'no-op';

    const result = await this.refund.execute({ appointmentId: origin, reason: 'hold-expired' });
    switch (result.outcome) {
      case 'refunded': {
        // The notification fires only when money moved AND the client has an
        // email registrado (notification-port spec: no email → no dispatch).
        if (view.originClientEmail) {
          await this.notifications.send({
            to: view.originClientEmail,
            template: 'cancellation_with_refund',
            data: { refundId: result.refundId, amountCents: String(result.amountCents) },
          });
          return 'refunded-and-notified';
        }
        return 'refunded';
      }
      // 428 — business state, NOT lost and NOT a tight loop: the pg-boss wiring
      // (next slice) requeues this with backoff; the notification MUST NOT fire
      // because the refund did not move.
      case 'pending-insufficient-funds':
        return 'retry';
      // Idempotent money + notify gate 2 — a prior run already flipped the
      // deposit to `refunded`: no second gateway call, no second notification.
      case 'already-refunded':
        return 'no-op';
      // The origin appointment had no seña (phone / walk-in) — nothing to
      // refund and no cancellation-with-refund to dispatch.
      case 'no-deposit':
        return 'no-op';
      default: {
        const _exhaustive: never = result;
        throw new Error(`ExpireHold: unhandled RefundOutcome ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
