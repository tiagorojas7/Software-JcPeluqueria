export type RecordSettledPaymentResult = 'confirmed' | 'already-processed' | 'hold-not-found';

/**
 * The symmetric, idempotent counterpart of `recordSettledPayment` for the
 * terminal-failure side of the webhook. design.md line 152: "Si MercadoPago
 * responde `rejected` o `cancelled`, se libera de inmediato sin esperar los
 * 15 minutos." Same atomic `UPDATE ... WHERE status='held' AND
 * payment_pending = true RETURNING id` shape as `confirm()`/`beginCheckout`
 * — zero rows means "already released by a retry or never existed", both of
 * which are no-ops for a webhook retry, so the caller treats `'no-op'` as
 * success (the hold is already where it should be).
 */
export type ReleaseRejectedPaymentResult = 'released' | 'no-op';

/**
 * The idempotency guard for the whole webhook flow — the same
 * "zero-rows-affected-means-lost" shape as `HoldRepository.confirm()`. A
 * retried `payment_id` hits `already-processed` and touches nothing, which
 * is exactly what the threat-matrix's "reintento del mismo payment_id →
 * cero filas afectadas" case proves at the database level.
 */
export interface DepositRepository {
  recordSettledPayment(input: {
    readonly holdId: string;
    readonly paymentId: string;
    readonly amountCents: number;
  }): Promise<RecordSettledPaymentResult>;

  /**
   * Releases a hold immediately on a terminal failure (`rejected` /
   * `cancelled`) and clears `payment_pending`. Idempotent — a retried
   * webhook firing `payment.process` twice affects one row on the first
   * call and zero on the second; the second returns `'no-op'` and is a
   * success, never an error.
   */
  releaseHoldOnRejectedPayment(holdId: string): Promise<ReleaseRejectedPaymentResult>;
}
