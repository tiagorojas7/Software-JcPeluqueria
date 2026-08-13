import { Body, Controller, Headers, HttpCode, Inject, Post, Query, UnauthorizedException } from '@nestjs/common';
import type { PaymentEventRepository, PaymentJobQueue } from '@jc-barberia/domain';
import { verifyMercadoPagoSignature } from '@jc-barberia/infrastructure';

import { Public } from '../access-control/decorators/public.decorator';
import { MERCADOPAGO_WEBHOOK_SECRET, PAYMENT_EVENT_REPOSITORY, PAYMENT_JOB_QUEUE } from './tokens';

/**
 * Public by design (`@Public()`) — MercadoPago carries no session cookie.
 * The signature IS the authentication. Every call is recorded in
 * `payment_events` first, valid or not; an invalid signature stops here
 * with `401` and NEVER reaches the queue — "cero efectos en el dominio" is
 * literal: nothing downstream of this handler ever runs.
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
