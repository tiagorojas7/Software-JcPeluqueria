/**
 * The deposit's own lifecycle, independent of the appointment's five states
 * — design.md's "La seña la decide el canal — invariante estructural".
 * Deliberately NOT `Deposit | null`: `not_applicable` (phone, walk-in)
 * carries the exact same shape-checking weight as every other case, so a
 * `switch` over `.kind` can never silently forget it — and per design.md it
 * will be the majority case, at least while phone bookings remain common.
 */
export type DepositState =
  | { readonly kind: 'not_applicable' }
  | { readonly kind: 'pending'; readonly paymentIntentId: string }
  | { readonly kind: 'settled'; readonly paymentId: string; readonly amountCents: number }
  | { readonly kind: 'refunded'; readonly refundId: string; readonly amountCents: number }
  | { readonly kind: 'forfeited'; readonly amountCents: number };
