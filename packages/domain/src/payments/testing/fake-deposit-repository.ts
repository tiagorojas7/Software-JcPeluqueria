import type { DepositRepository, RecordSettledPaymentResult } from '../deposit-repository';

export interface RecordedSettledPaymentCall {
  readonly holdId: string;
  readonly paymentId: string;
  readonly amountCents: number;
}

/**
 * In-memory `DepositRepository` test double. Simulates the real idempotency
 * guard with a `Set` of already-processed payment ids — good enough to prove
 * a use case's orchestration; the actual atomic guarantee only exists
 * against PostgreSQL (`DrizzleDepositRepository`'s Testcontainers suite).
 */
export class FakeDepositRepository implements DepositRepository {
  readonly calls: RecordedSettledPaymentCall[] = [];
  private readonly processedPaymentIds = new Set<string>();

  async recordSettledPayment(input: RecordedSettledPaymentCall): Promise<RecordSettledPaymentResult> {
    this.calls.push(input);
    if (this.processedPaymentIds.has(input.paymentId)) {
      return 'already-processed';
    }
    this.processedPaymentIds.add(input.paymentId);
    return 'confirmed';
  }
}
