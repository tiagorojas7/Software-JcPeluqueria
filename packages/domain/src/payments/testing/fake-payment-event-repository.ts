import type { PaymentEventRepository } from '../payment-event-repository';

export interface RecordedPaymentEvent {
  readonly paymentId: string;
  readonly rawPayload: unknown;
  readonly signatureValid: boolean;
}

/** In-memory `PaymentEventRepository` test double. */
export class FakePaymentEventRepository implements PaymentEventRepository {
  readonly records: RecordedPaymentEvent[] = [];

  async record(input: RecordedPaymentEvent): Promise<void> {
    this.records.push(input);
  }
}
