import type { PaymentJobQueue } from '@jc-barberia/domain';

import type { JobSender } from '../booking/pg-boss-hold-expire-scheduler';

/**
 * The queue name shared by the producer (this adapter, `MercadoPagoWebhookController`)
 * and the consumer (`apps/worker`) — a constant so the two sides cannot drift
 * apart through a typo, same reasoning as `HOLD_EXPIRE_QUEUE`.
 */
export const PAYMENT_PROCESS_QUEUE = 'payment.process';

/**
 * Production `PaymentJobQueue`. The webhook (5.9/5.10) enqueues a payment id
 * and returns `200` immediately — this is the only thing standing between
 * that enqueue and the worker actually calling `ProcessPaymentUseCase`
 * (9.12: "conectar... a la confirmacion por webhook"). Before this adapter
 * existed, `PaymentsModule` bound `PAYMENT_JOB_QUEUE` to a placeholder that
 * threw on first use — real, but never wired into `AppModule`.
 *
 * No `startAfter`/transaction handling like `PgBossHoldExpireScheduler`:
 * design.md's webhook sequence has nothing to roll back together with this
 * enqueue (the payment event is already durably recorded before this runs),
 * and nothing schedules it for later — it should run as soon as the worker
 * is free.
 */
export class PgBossPaymentJobQueue implements PaymentJobQueue {
  constructor(private readonly boss: JobSender) {}

  async enqueueProcessPayment(input: { readonly paymentId: string }): Promise<void> {
    await this.boss.send(PAYMENT_PROCESS_QUEUE, { paymentId: input.paymentId });
  }
}
