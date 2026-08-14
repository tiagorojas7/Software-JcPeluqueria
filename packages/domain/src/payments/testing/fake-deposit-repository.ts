import type {
  DepositRepository,
  RecordSettledPaymentResult,
  ReleaseRejectedPaymentResult,
} from '../deposit-repository';

export interface RecordedSettledPaymentCall {
  readonly holdId: string;
  readonly paymentId: string;
  readonly amountCents: number;
}

export interface RecordedReleaseCall {
  readonly holdId: string;
}

/**
 * In-memory `DepositRepository` test double. Simulates the real idempotency
 * guard with a `Set` of already-processed payment ids — good enough to prove
 * a use case's orchestration; the actual atomic guarantee only exists
 * against PostgreSQL (`DrizzleDepositRepository`'s Testcontainers suite).
 */
export class FakeDepositRepository implements DepositRepository {
  readonly calls: RecordedSettledPaymentCall[] = [];
  readonly releaseCalls: RecordedReleaseCall[] = [];
  private readonly processedPaymentIds = new Set<string>();
  private readonly releasedHoldIds = new Set<string>();

  async recordSettledPayment(input: RecordedSettledPaymentCall): Promise<RecordSettledPaymentResult> {
    this.calls.push(input);
    if (this.processedPaymentIds.has(input.paymentId)) {
      return 'already-processed';
    }
    this.processedPaymentIds.add(input.paymentId);
    return 'confirmed';
  }

  /** Mirrors `recordSettledPayment`'s idempotency shape: records every call
   *  (so a test can assert the use case retried), returns `'released'` on
   *  the first call for a hold and `'no-op'` on every retry. Real
   *  PostgreSQL-level atomicity lives only in `DrizzleDepositRepository`'s
   *  Testcontainers proof. */
  async releaseHoldOnRejectedPayment(holdId: string): Promise<ReleaseRejectedPaymentResult> {
    this.releaseCalls.push({ holdId });
    if (this.releasedHoldIds.has(holdId)) {
      return 'no-op';
    }
    this.releasedHoldIds.add(holdId);
    return 'released';
  }
}
