import type {
  CreatePreferenceResult,
  PaymentPort,
  PaymentStatusResult,
  RefundResult,
} from '../payment-port';

export interface RecordedRefundCall {
  readonly paymentId: string;
  readonly amountCents: number;
}

export interface RecordedCreatePreferenceCall {
  readonly externalReference: string;
  readonly amountCents: number;
  readonly description: string;
}

/**
 * In-memory `PaymentPort` test double — the same role `FakeHoldRepository`
 * plays for `HoldRepository`. Records every call so a test can assert a
 * refund/preference was (or, just as importantly, was NOT) requested,
 * without a live gateway. The real adapter (`MercadoPagoPaymentAdapter`)
 * lives in `packages/infrastructure`.
 */
export class FakePaymentPort implements PaymentPort {
  readonly refundCalls: RecordedRefundCall[] = [];
  readonly createPreferenceCalls: RecordedCreatePreferenceCall[] = [];
  readonly getPaymentCalls: string[] = [];
  private nextRefundId = 1;
  private nextPreferenceId = 1;

  /** @param paymentStatus What every `getPayment()` call resolves to. */
  constructor(private readonly paymentStatus: PaymentStatusResult | null = null) {}

  async createPreference(input: {
    externalReference: string;
    amountCents: number;
    description: string;
  }): Promise<CreatePreferenceResult> {
    this.createPreferenceCalls.push(input);
    const preferenceId = `fake-preference-${this.nextPreferenceId++}`;
    return { preferenceId, initPoint: `https://mercadopago.example/${preferenceId}` };
  }

  async getPayment(paymentId: string): Promise<PaymentStatusResult> {
    this.getPaymentCalls.push(paymentId);
    if (!this.paymentStatus) {
      throw new Error('FakePaymentPort.getPayment called with no paymentStatus configured');
    }
    return this.paymentStatus;
  }

  async refund(input: { paymentId: string; amountCents: number }): Promise<RefundResult> {
    this.refundCalls.push({ paymentId: input.paymentId, amountCents: input.amountCents });
    return { refundId: `fake-refund-${this.nextRefundId++}` };
  }
}
