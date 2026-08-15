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

  // RED (6.4) — behaviour lands in GREEN 6.5. This stub proves the suite runs
  // and fails first; committing it green-red keeps the TDD order auditable.
  async execute(holdId: string): Promise<ExpireHoldOutcome> {
    await this.views.loadForExpire(holdId);
    throw new Error('ExpireHold.execute not implemented — fill in 6.5');
  }
}
