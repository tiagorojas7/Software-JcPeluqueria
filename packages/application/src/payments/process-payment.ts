import type { DepositRepository, PaymentPort, PaymentStatus, RecordSettledPaymentResult } from '@jc-barberia/domain';

export type ProcessPaymentResult =
  | { readonly outcome: RecordSettledPaymentResult }
  | { readonly outcome: 'ignored'; readonly status: PaymentStatus };

/**
 * This IS "the worker" design.md describes: it never trusts the webhook
 * payload or the browser redirect, only `PaymentPort.getPayment()`'s own
 * answer. Enqueuing/consuming via pg-boss (Phase 6) is orthogonal to this
 * logic — whatever calls `execute(paymentId)` plays that role.
 */
export class ProcessPaymentUseCase {
  constructor(
    private readonly paymentPort: PaymentPort,
    private readonly deposits: DepositRepository,
  ) {}

  async execute(paymentId: string): Promise<ProcessPaymentResult> {
    const payment = await this.paymentPort.getPayment(paymentId);
    if (payment.status !== 'approved') {
      return { outcome: 'ignored', status: payment.status };
    }

    const outcome = await this.deposits.recordSettledPayment({
      holdId: payment.externalReference,
      paymentId: payment.paymentId,
      amountCents: payment.amountCents,
    });
    return { outcome };
  }
}
