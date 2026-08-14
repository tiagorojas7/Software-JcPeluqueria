import type {
  DepositRepository,
  PaymentPort,
  PaymentStatus,
  RecordSettledPaymentResult,
  ReleaseRejectedPaymentResult,
} from '@jc-barberia/domain';

export type ProcessPaymentResult =
  | { readonly outcome: RecordSettledPaymentResult }
  | { readonly outcome: ReleaseRejectedPaymentResult; readonly status: 'rejected' | 'cancelled' }
  | { readonly outcome: 'ignored'; readonly status: PaymentStatus };

/**
 * This IS "the worker" design.md describes: it never trusts the webhook
 * payload or the browser redirect, only `PaymentPort.getPayment()`'s own
 * answer. Enqueuing/consuming via pg-boss (Phase 6) is orthogonal to this
 * logic — whatever calls `execute(paymentId)` plays that role.
 *
 * Three branches, matching MercadoPago's own terminal/non-terminal split:
 *   - `approved`     → record the settled deposit, flip the hold to reservado
 *   - `rejected` /
 *     `cancelled`    → terminal failure: release the hold NOW, do not wait
 *                      the 15 min (design.md line 152). Idempotent — a retried
 *                      webhook reports `no-op` for a hold already released.
 *   - `pending` /
 *     `in_process`   → not terminal: the payment can still flip to approved,
 *                      so the hold stays put (the 5.18 fix keeps the timer off
 *                      it) and this is a plain no-op.
 */
export class ProcessPaymentUseCase {
  constructor(
    private readonly paymentPort: PaymentPort,
    private readonly deposits: DepositRepository,
  ) {}

  async execute(paymentId: string): Promise<ProcessPaymentResult> {
    const payment = await this.paymentPort.getPayment(paymentId);
    if (payment.status === 'approved') {
      const outcome = await this.deposits.recordSettledPayment({
        holdId: payment.externalReference,
        paymentId: payment.paymentId,
        amountCents: payment.amountCents,
      });
      return { outcome };
    }

    if (payment.status === 'rejected' || payment.status === 'cancelled') {
      const outcome = await this.deposits.releaseHoldOnRejectedPayment(payment.externalReference);
      return { outcome, status: payment.status };
    }

    return { outcome: 'ignored', status: payment.status };
  }
}
