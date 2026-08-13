import type { PaymentPort, RefundResult } from '../payment-port';

export interface RecordedRefundCall {
  readonly paymentId: string;
  readonly amountCents: number;
}

/**
 * In-memory `PaymentPort` test double — the same role `FakeHoldRepository`
 * plays for `HoldRepository`. Records every call so a test can assert a
 * refund was (or, just as importantly, was NOT) requested, without a live
 * gateway. The real adapter (`MercadoPagoPaymentAdapter`) arrives in Phase 5.
 */
export class FakePaymentPort implements PaymentPort {
  readonly refundCalls: RecordedRefundCall[] = [];
  private nextRefundId = 1;

  async refund(input: { paymentId: string; amountCents: number }): Promise<RefundResult> {
    this.refundCalls.push({ paymentId: input.paymentId, amountCents: input.amountCents });
    return { refundId: `fake-refund-${this.nextRefundId++}` };
  }
}
