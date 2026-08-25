import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ClaimPaymentRequestSchema, type ClaimPaymentResponseBody } from '@jc-barberia/contracts';
import type { PaymentJobQueue } from '@jc-barberia/domain';

import { Public } from '../access-control/decorators/public.decorator';
import { PAYMENT_JOB_QUEUE } from './tokens';

/**
 * The SECOND way a payment gets processed — the client's own return from
 * MercadoPago, alongside the webhook.
 *
 * The webhook is one delivery attempt to one URL, and it does go missing. It
 * happened in production: an approved payment of ARS 6.000 whose
 * `notification_url` was correct produced no notification at all, and the
 * hold sat minutes from expiring with the money already taken. A booking that
 * was really paid for must not depend on a single HTTP call arriving.
 *
 * MercadoPago appends `payment_id` to the `back_urls` it redirects to, so the
 * returning client already carries the one fact needed. `PaymentReturnPage`
 * posts it here on arrival.
 *
 * `@Public()` for the same reason the webhook is: whoever just paid has no
 * session — a web booking creates the account only after the turno confirms.
 * And like the webhook, this endpoint TRUSTS NOTHING it is given. It enqueues
 * a question, never an answer: the worker asks MercadoPago about that id
 * through `ProcessPaymentUseCase`, which confirms nothing unless MercadoPago
 * itself says `approved`, and which ignores an id whose `external_reference`
 * points at somebody else's hold. Sending a forged id buys nothing that
 * sending a forged `data.id` to the webhook would not already buy.
 *
 * Enqueueing twice is free: `deposits.payment_id` is UNIQUE and
 * `recordSettledPayment` resolves the loser of that race to
 * `already-processed`, so the webhook and this route landing together is an
 * ordinary no-op, not a double booking.
 */
@Controller('payments')
export class PaymentClaimController {
  constructor(@Inject(PAYMENT_JOB_QUEUE) private readonly queue: PaymentJobQueue) {}

  @Public()
  @Post('claim')
  @HttpCode(202)
  async claim(@Body() body: unknown): Promise<ClaimPaymentResponseBody> {
    const parsed = ClaimPaymentRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    await this.queue.enqueueProcessPayment({ paymentId: parsed.data.paymentId });
    // 202, not 200: the turno is NOT confirmed by the time this answers. The
    // page that called this must keep saying "estamos confirmando", exactly
    // as it already does — design.md is explicit that the browser redirect is
    // never the source of truth.
    return { claimed: true };
  }
}
