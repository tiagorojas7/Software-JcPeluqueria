import { Module } from '@nestjs/common';
import type { PaymentJobQueue } from '@jc-barberia/domain';
import { db, DrizzlePaymentEventRepository } from '@jc-barberia/infrastructure';

import { MercadoPagoWebhookController } from './mercadopago-webhook.controller';
import { MERCADOPAGO_WEBHOOK_SECRET, PAYMENT_EVENT_REPOSITORY, PAYMENT_JOB_QUEUE } from './tokens';

/**
 * `PAYMENT_JOB_QUEUE` has no working default: pg-boss and its worker are
 * Phase 6. This throws loudly instead of silently dropping a payment
 * confirmation if this module is ever wired into `AppModule` before then —
 * deliberately not imported there yet (real business endpoints start Phase
 * 8/9/10; the same reason `NotificationPort` has no production binding
 * either). Tests override this provider directly, same pattern as
 * `authorization.contract.spec.ts` overriding `ROLE_PERMISSION_REPOSITORY`.
 */
class UnwiredPaymentJobQueue implements PaymentJobQueue {
  async enqueueProcessPayment(): Promise<void> {
    throw new Error('PaymentJobQueue is not wired yet — Phase 6 provides the pg-boss adapter.');
  }
}

@Module({
  controllers: [MercadoPagoWebhookController],
  providers: [
    { provide: PAYMENT_EVENT_REPOSITORY, useFactory: () => new DrizzlePaymentEventRepository(db) },
    { provide: PAYMENT_JOB_QUEUE, useClass: UnwiredPaymentJobQueue },
    { provide: MERCADOPAGO_WEBHOOK_SECRET, useFactory: () => process.env.MERCADOPAGO_WEBHOOK_SECRET ?? '' },
  ],
})
export class PaymentsModule {}
