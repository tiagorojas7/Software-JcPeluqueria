export type RecordSettledPaymentResult = 'confirmed' | 'already-processed' | 'hold-not-found';

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
}
