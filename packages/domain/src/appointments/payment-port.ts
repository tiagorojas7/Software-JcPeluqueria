export interface RefundResult {
  readonly refundId: string;
}

export interface CreatePreferenceResult {
  readonly preferenceId: string;
  readonly initPoint: string;
}

/** Statuses MercadoPago itself reports back for a payment. */
export type PaymentStatus = 'approved' | 'pending' | 'rejected' | 'cancelled' | 'in_process';

export interface PaymentStatusResult {
  readonly paymentId: string;
  readonly status: PaymentStatus;
  readonly amountCents: number;
  /** The hold/appointment id, round-tripped through MercadoPago's own
   *  `external_reference` field — set at `createPreference()` time, read
   *  back here so the caller knows which row to confirm. */
  readonly externalReference: string;
}

/**
 * The only way money moves between the shop and MercadoPago. Phase 4 needed
 * only `refund()` to prove `resolveDepositForCancellation` correct against
 * `FakePaymentPort` (design.md's phase table: "Ciclo de vida del turno +
 * DepositState con FakePaymentPort"); Phase 5 adds the other two members and
 * the real adapter (`MercadoPagoPaymentAdapter`).
 *
 * Forfeiting a deposit (see `resolveDepositForAbsence`) deliberately has no
 * method here — the shop simply keeps money it already holds, which needs
 * no gateway call at all, only a `DepositState` change.
 */
export interface PaymentPort {
  /** Creates the Checkout Pro preference the client is redirected to. */
  createPreference(input: {
    readonly externalReference: string;
    readonly amountCents: number;
    readonly description: string;
  }): Promise<CreatePreferenceResult>;
  /** The webhook's `data.id` is never trusted directly — this is the
   *  "fuente de verdad" call design.md requires before confirming anything. */
  getPayment(paymentId: string): Promise<PaymentStatusResult>;
  refund(input: { readonly paymentId: string; readonly amountCents: number }): Promise<RefundResult>;
}
