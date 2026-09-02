import { BadRequestException, Body, Controller, Headers, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { MercadoPagoWebhookBodySchema } from '@jc-barberia/contracts';
import type { PaymentEventRepository, PaymentJobQueue } from '@jc-barberia/domain';
import { verifyMercadoPagoSignature } from '@jc-barberia/infrastructure';

import { Public } from '../access-control/decorators/public.decorator';
import { MERCADOPAGO_WEBHOOK_SECRET, PAYMENT_EVENT_REPOSITORY, PAYMENT_JOB_QUEUE } from './tokens';

/**
 * Public by design (`@Public()`) — MercadoPago carries no session cookie.
 *
 * The signature is RECORDED, not enforced. It proves who is calling; it does
 * not prove the fact this endpoint exists to learn. What proves that fact is
 * `PaymentPort.getPayment`, which `ProcessPaymentUseCase` already consults
 * before touching anything — the port's own doc comment states it: "the
 * webhook's `data.id` is never trusted directly ... the 'fuente de verdad'
 * call design.md requires before confirming anything".
 *
 * Enforcing it here cost real bookings. Four different secrets taken from the
 * MercadoPago panel failed to validate against live captured traffic, so every
 * approved payment stayed `held` and no client ever received a confirmation
 * email — while the notification that would have told us the truth was being
 * discarded at the door.
 *
 * So an unverified call is enqueued all the same, and `signature_valid` keeps
 * the audit trail honest. Enqueueing confirms nothing: it only schedules the
 * question we then ask MercadoPago directly. A forged id cannot fabricate an
 * approval, and an id belonging to somebody else's payment carries a
 * different `external_reference`, which `ProcessPaymentUseCase` ignores.
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
    @Query('data.id') dataId: string | undefined,
    @Query('id') legacyId: string | undefined,
    @Query('type') type: string | undefined,
    @Query('topic') topic: string | undefined,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    // MercadoPago delivers the same event through two shapes — both observed
    // in real captured traffic: `?data.id=<id>&type=payment` (current) and
    // `?id=<id>&topic=payment` (legacy IPN). Only the first used to be
    // accepted, and one real approved payment arrived through the legacy one
    // ALONE, so it never confirmed.
    const paymentId = resolvePaymentId({ dataId, legacyId, type, topic });
    if (!paymentId) {
      // Nothing here names a payment to ask MercadoPago about — a
      // `merchant_order` notification, or a stray POST. Answering 200 stops
      // MercadoPago from redelivering something we have no use for; a 4xx
      // would make it retry forever. No audit row either: this endpoint keys
      // that table by payment id, and there is none.
      return { received: true };
    }

    // A public endpoint gets whatever the caller feels like sending —
    // verified in production: a notification with no usable JSON body (no
    // `Content-Type: application/json`, an empty body) used to reach
    // `events.record` anyway and die on `payment_events.raw_payload`'s
    // `NOT NULL`, answering with a 500 that MercadoPago retries forever. See
    // `MercadoPagoWebhookBodySchema`'s own doc comment for why this checks
    // shape only, never MercadoPago's actual fields.
    const parsedBody = MercadoPagoWebhookBodySchema.safeParse(body);
    if (!parsedBody.success) {
      throw new BadRequestException(parsedBody.error.flatten());
    }

    // Recorded for the audit trail, never used as a gate — see this class's
    // own doc comment for why.
    const signatureValid = verifyMercadoPagoSignature({
      xSignature,
      xRequestId,
      dataId: paymentId,
      secret: this.webhookSecret,
    });

    await this.events.record({ paymentId, rawPayload: parsedBody.data, signatureValid });
    await this.queue.enqueueProcessPayment({ paymentId: paymentId.toLowerCase() });
    return { received: true };
  }
}

/**
 * The payment id a notification is about, or `null` when it is not about a
 * payment at all. `type` and `topic` are the two names MercadoPago gives the
 * same field; any other value — `merchant_order` above all — names a
 * different resource whose id would simply 404 against `/v1/payments/{id}`.
 */
function resolvePaymentId(input: {
  readonly dataId: string | undefined;
  readonly legacyId: string | undefined;
  readonly type: string | undefined;
  readonly topic: string | undefined;
}): string | null {
  const kind = input.type ?? input.topic;
  if (kind !== undefined && kind !== 'payment') {
    return null;
  }
  return input.dataId ?? input.legacyId ?? null;
}
