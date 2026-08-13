import type { PaymentJobQueue } from '../payment-job-queue';

/** In-memory `PaymentJobQueue` test double — records every enqueue call, never runs one. */
export class FakePaymentJobQueue implements PaymentJobQueue {
  readonly enqueuedPaymentIds: string[] = [];

  async enqueueProcessPayment(input: { paymentId: string }): Promise<void> {
    this.enqueuedPaymentIds.push(input.paymentId);
  }
}
