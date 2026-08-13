export interface RefundResult {
  readonly refundId: string;
}

/**
 * The only way a deposit's money actually moves back to the client. Phase 5
 * supplies the real adapter (`MercadoPagoPaymentAdapter`); this phase only
 * needs the port itself and `FakePaymentPort`, so `resolveDepositForCancellation`
 * can be proven correct without a live gateway (design.md's phase table:
 * "Ciclo de vida del turno + DepositState con FakePaymentPort").
 *
 * Forfeiting a deposit (see `resolveDepositForAbsence`) deliberately has no
 * method here — the shop simply keeps money it already holds, which needs
 * no gateway call at all, only a `DepositState` change.
 */
export interface PaymentPort {
  refund(input: { readonly paymentId: string; readonly amountCents: number }): Promise<RefundResult>;
}
