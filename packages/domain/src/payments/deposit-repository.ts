import type { DepositState } from '../appointments/deposit-state';

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
 * What `findDepositForAppointment` returns for a given `slot_occupancies`
 * appointment id. `depositId` is `null` only when `state.kind ===
 * 'not_applicable'` (phone / walk-in — the appointment exists but was never
 * charged a deposit). The `refunded` kind's `refundId` is loaded as `''`
 * because the `deposits` table does not store the gateway's refund id (per
 * design.md row 457 the schema is `amount_cents` / `payment_id UNIQUE` /
 * `state` only); the use case only needs to distinguish `refunded` from
 * `settled` for its idempotent short-circuit.
 */
export interface LoadedDeposit {
  readonly depositId: string | null;
  readonly state: DepositState;
}

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

  /**
   * Loads the deposit attached to a `slot_occupancies` appointment row,
   * used by `RefundUseCase` to decide whether a refund is due, already done
   * or doesn't apply. Returns `null` if the appointment id itself does not
   * exist (loud — a refund requested against a non-existent appointment is
   * a caller bug, not a no-op).
   */
  findDepositForAppointment(appointmentId: string): Promise<LoadedDeposit | null>;

  /**
   * Flips a settled deposit's `state` to `refunded` after the gateway
   * confirms the refund. Idempotent at the SQL level (`WHERE state='settled'`)
   * — a retried refund against a deposit already marked `refunded` affects
   * zero rows and is a no-op. `refundId` is accepted for the audit trail
   * even though the current `deposits` schema does not persist it yet
   * (rtl future-proofing for a `refund_id` column, design.md row 457).
   */
  markRefunded(input: { readonly depositId: string; readonly refundId: string }): Promise<void>;
}
