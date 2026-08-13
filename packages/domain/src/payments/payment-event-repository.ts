/**
 * Raw audit trail — design.md: "Tabla payment_events con el payload crudo y
 * el veredicto de firma, para conciliación." Written for EVERY webhook call,
 * valid signature or not; recording a rejected call is itself the "cero
 * efectos en el dominio" evidence for the invalid-signature threat-matrix
 * case — the event is the ONLY row that call ever produces.
 */
export interface PaymentEventRepository {
  record(input: {
    readonly paymentId: string;
    readonly rawPayload: unknown;
    readonly signatureValid: boolean;
  }): Promise<void>;
}
