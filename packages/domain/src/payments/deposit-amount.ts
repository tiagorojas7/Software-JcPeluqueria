/**
 * design.md client-booking: "Reserva web con seña obligatoria del 50%". The
 * deposit is always exactly half the service's list price, rounded to the
 * nearest cent so the result stays an integer — MercadoPago rejects
 * fractional cents.
 */
export function depositAmountCents(priceCents: number): number {
  return Math.round(priceCents / 2);
}
