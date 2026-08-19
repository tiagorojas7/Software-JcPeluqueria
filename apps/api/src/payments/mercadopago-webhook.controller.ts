import { Body, Controller, Headers, HttpCode, Inject, Post, Query, UnauthorizedException } from '@nestjs/common';
import type { PaymentEventRepository, PaymentJobQueue } from '@jc-barberia/domain';
import { verifyMercadoPagoSignature } from '@jc-barberia/infrastructure';

import { Public } from '../access-control/decorators/public.decorator';
import { MERCADOPAGO_WEBHOOK_SECRET, PAYMENT_EVENT_REPOSITORY, PAYMENT_JOB_QUEUE } from './tokens';

/**
 * Public by design (`@Public()`) — MercadoPago carries no session cookie.
 * The signature IS the authentication. Every call that identifies a resource
 * is recorded in `payment_events` first, valid or not; an invalid signature
 * stops here with `401` and NEVER reaches the queue — "cero efectos en el
 * dominio" is literal: nothing downstream of this handler ever runs.
 *
 * `data.id` comes from the QUERY STRING, not the body. MercadoPago appends it
 * to `notification_url` and that query value is what its own SDKs feed to the
 * signature validator, so reading it anywhere else would validate a different
 * string than the one that was signed. The body carries the same id, but it
 * is treated as opaque payload here — only the signed query value is trusted.
 *
 * Deliberately does no payment processing itself (design.md: "responder 200
 * de inmediato, procesar de forma asíncrona"). `ProcessPaymentUseCase`
 * (`packages/application`) is what a Phase 6 worker calls per enqueued id.
 */
@Controller('webhooks/mercadopago')
export class MercadoPagoWebhookController {
  constructor(
    @Inject(PAYMENT_EVENT_REPOSITORY) private readonly events: PaymentEventRepository,
    @Inject(PAYMENT_JOB_QUEUE) private readonly queue: PaymentJobQueue,
    @Inject(MERCADOPAGO_WEBHOOK_SECRET) private readonly webhookSecret: string,
  ) {}

  @Public()
  @Post()
  @HttpCode(200)
  async handle(
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
    @Query('data.id') dataId: string,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    // A notification with no `data.id` is not MercadoPago: that value is
    // always appended to `notification_url`, and it is precisely what the
    // signature is computed over, so without it no signature can ever verify.
    // It is rejected before the audit write rather than after, because
    // `payment_events.payment_id` is NOT NULL — passing `undefined` through
    // turned every such call into a 500 from a constraint violation, which on
    // a public unauthenticated endpoint is a crash any stray POST can trigger.
    // No audit row is written because there is no resource id to key one on.
    if (!dataId) {
      throw new UnauthorizedException('Invalid MercadoPago webhook signature');
    }

    const signatureValid = verifyMercadoPagoSignature({
      xSignature,
      xRequestId,
      dataId,
      secret: this.webhookSecret,
    });

    await this.events.record({ paymentId: dataId, rawPayload: body, signatureValid });

    if (!signatureValid) {
      throw new UnauthorizedException('Invalid MercadoPago webhook signature');
    }

    await this.queue.enqueueProcessPayment({ paymentId: dataId.toLowerCase() });
    return { received: true };
  }
}
