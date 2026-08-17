import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { db, DrizzlePaymentEventRepository, lazyJobSender, PgBossPaymentJobQueue, stopJobSender } from '@jc-barberia/infrastructure';

import { MercadoPagoWebhookController } from './mercadopago-webhook.controller';
import { MERCADOPAGO_WEBHOOK_SECRET, PAYMENT_EVENT_REPOSITORY, PAYMENT_JOB_QUEUE } from './tokens';

/**
 * Task 9.12's production half: `PAYMENT_JOB_QUEUE` used to bind to a
 * placeholder that threw on first use ("Phase 6 provides the real
 * pg-boss-backed adapter") and this module was deliberately never imported
 * into `AppModule` — real business endpoints start Phase 8/9/10. Both gaps
 * close together here: `PgBossPaymentJobQueue` (9.11/9.12) is the real
 * adapter, and `AppModule` now imports this module for real.
 *
 * Synchronous factory on purpose, same reasoning as every other pg-boss
 * producer in this app (`HOLD_EXPIRE_SCHEDULER` in `BookingModule`/
 * `AppointmentsModule`): `lazyJobSender()` defers the connection to the
 * first enqueue, so building the module graph never touches the network —
 * an `async useFactory` here would reopen the exact bug that already broke
 * every Nest test with ECONNREFUSED before its first assertion, twice.
 * Tests still override this provider directly (`mercadopago-webhook.spec.ts`,
 * `checkout.spec.ts`), same pattern as every other module in this app.
 */
@Module({
  controllers: [MercadoPagoWebhookController],
  providers: [
    { provide: PAYMENT_EVENT_REPOSITORY, useFactory: () => new DrizzlePaymentEventRepository(db) },
    { provide: PAYMENT_JOB_QUEUE, useFactory: () => new PgBossPaymentJobQueue(lazyJobSender()) },
    { provide: MERCADOPAGO_WEBHOOK_SECRET, useFactory: () => process.env.MERCADOPAGO_WEBHOOK_SECRET ?? '' },
  ],
})
export class PaymentsModule implements OnApplicationShutdown {
  /** pg-boss keeps its own pool open; without this the process hangs on
   *  exit — same reason `BookingModule`/`AppointmentsModule` implement this
   *  too. `stopJobSender()` is idempotent, so a shared shutdown with those
   *  modules never double-stops anything. */
  async onApplicationShutdown(): Promise<void> {
    await stopJobSender();
  }
}
