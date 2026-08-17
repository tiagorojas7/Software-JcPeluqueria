import { describe, expect, it } from 'vitest';

import { PgBossPaymentJobQueue } from './pg-boss-payment-job-queue';

// 9.11/9.12 GREEN (production half) — the webhook (5.10) has enqueued
// through `PaymentJobQueue` since Phase 5, but `apps/api/src/payments/
// payments.module.ts` only ever bound it to `UnwiredPaymentJobQueue`
// ("Phase 6 provides the real pg-boss-backed adapter"). Same gap
// `PgBossHoldExpireScheduler` (6.3) closed for `HoldExpireScheduler`: without
// this adapter, "conectar... a la confirmacion por webhook" (9.12) would stay
// theoretical — the webhook could accept a payload but the confirmation job
// would never actually reach the worker in production.
//
// pg-boss is never started here, same reasoning as
// `pg-boss-hold-expire-scheduler.spec.ts`: the adapter's whole job is a
// translation from the port call onto `boss.send(name, data)`, so a
// recording fake proves the two things that matter — the queue name the
// worker subscribes to, and that the paymentId is forwarded untouched.

interface RecordedSend {
  readonly name: string;
  readonly data: unknown;
}

function fakeBoss() {
  const sent: RecordedSend[] = [];
  return {
    sent,
    send: async (name: string, data: unknown) => {
      sent.push({ name, data });
      return 'job-id';
    },
  };
}

describe('PgBossPaymentJobQueue (9.11/9.12)', () => {
  it('encola en la cola payment.process que el worker consume, con el paymentId como payload', async () => {
    const boss = fakeBoss();
    const queue = new PgBossPaymentJobQueue(boss);

    await queue.enqueueProcessPayment({ paymentId: 'payment-1' });

    expect(boss.sent).toEqual([{ name: 'payment.process', data: { paymentId: 'payment-1' } }]);
  });
});
