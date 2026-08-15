/**
 * The slice of an occupancy row the `hold.expire` handler needs to decide
 * whether its NON-lazy effects — origin seña refund + cancellation
 * notification — "corresponden" (design.md line 144: "el job existe por la
 * plata y por el aviso"). The slot liberation itself is lazy (handled on the
 * availability read path: `DrizzleHoldRepository.releaseExpiredHolds`) and
 * Phase 12 owns the origin appointment's slot/cancel side; this view carries
 * ONLY the money + notify decision inputs, so the handler never reads a
 * fresh wall-clock and never knows about transport.
 *
 * - `isHeld` turns `false` the moment another path (confirm / rejected
 *   payment / lazy liberation / a prior run) moved the row out of `held` — a
 *   retried job short-circuits here, idempotent.
 * - `paymentPending` keeps the "Regla que elimina el peor caso" (design 150):
 *   a hold with a payment in flight is never acted on by the timer — it waits
 *   for `ProcessPaymentUseCase`'s terminal state instead.
 * - `originOccupancyId` non-null is the absence-offer hold (Phase 12 owns the
 *   slot/cancel side + the no-seña branch); here it is the trigger key for the
 *   settled origin seña refund the slot-hold spec names "Hold vencido con
 *   cobro asociado".
 * - `originClientEmail` gates the notification (notification-port spec: a
 *   client without an email registrado receives no dispatch).
 */
export interface ExpiredHoldView {
  readonly holdId: string;
  readonly isHeld: boolean;
  readonly paymentPending: boolean;
  readonly originOccupancyId: string | null;
  readonly originClientEmail: string | null;
}

/**
 * Loads exactly the `ExpiredHoldView` for one hold id, or `null` if the row
 * no longer exists (cleaned up / never persisted). The infra adapter joins
 * `slot_occupancies` to `clients` for the email; a fake stands in for unit
 * tests so the handler's decision logic never needs a database.
 */
export interface HoldExpireViewRepository {
  loadForExpire(holdId: string): Promise<ExpiredHoldView | null>;
}
