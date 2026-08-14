import {
  HOLD_DURATION_MINUTES,
  depositAmountCents,
  type Clock,
  type HoldRepository,
  type PaymentPort,
} from '@jc-barberia/domain';

export interface CheckoutInput {
  readonly holdId: string;
  readonly priceCents: number;
  readonly description: string;
}

export type CheckoutResult =
  | { readonly outcome: 'created'; readonly initPoint: string; readonly preferenceId: string }
  | { readonly outcome: 'hold-expired' };

/**
 * design.md's checkout sequence: re-validate the hold (extending its expiry
 * for the payment window, same shape as `ConfirmHold`'s re-validation) before
 * ever talking to MercadoPago. A hold that already expired never reaches
 * `PaymentPort.createPreference` — there is nothing to charge a deposit
 * against.
 */
export class CheckoutUseCase {
  constructor(
    private readonly holds: HoldRepository,
    private readonly paymentPort: PaymentPort,
    private readonly clock: Clock,
  ) {}

  async execute(input: CheckoutInput): Promise<CheckoutResult> {
    const paymentExpiresAt = this.clock.addMinutes(this.clock.now(), HOLD_DURATION_MINUTES);
    const began = await this.holds.beginCheckout(input.holdId, paymentExpiresAt);
    if (!began) {
      return { outcome: 'hold-expired' };
    }

    const preference = await this.paymentPort.createPreference({
      externalReference: input.holdId,
      amountCents: depositAmountCents(input.priceCents),
      description: input.description,
    });
    return { outcome: 'created', initPoint: preference.initPoint, preferenceId: preference.preferenceId };
  }
}
