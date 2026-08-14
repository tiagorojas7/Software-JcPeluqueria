import type { DepositRepository, PaymentPort } from '@jc-barberia/domain';

/** The two trigger sources the slot-hold / client-booking specs name for an
 *  automatic seña refund. Reason itself never changes the money path — the
 *  seña is indivisible, a full refund either way — but it forces the caller
 *  to declare why the refund was requested, which Phase 6 will use to derive
 *  the stable `X-Idempotency-Key` (`deposit_id` + motive, research sec.4). */
export type RefundReason = 'client-cancel' | 'hold-expired';

export interface RefundInput {
  readonly appointmentId: string;
  readonly reason: RefundReason;
}

export type RefundOutcome =
  /** The refund was issued and the deposit's `state` flipped to
   *  `refunded`. Carries the gateway's `refundId` for the caller's audit /
   *  notification content. */
  | { readonly outcome: 'refunded'; readonly refundId: string; readonly amountCents: number }
  /** The appointment had no deposit (`not_applicable` — phone / walk-in):
   *  no gateway call, no DB write — the cancellation effect still runs in
   *  the caller; the money side is a no-op (design.md "not_applicable"). */
  | { readonly outcome: 'no-deposit' }
  /** A previous call already refunded this deposit — idempotent retry, no
   *  second gateway call. (The gateway's own `409 order_already_refunded`
   *  is handled inside the adapter as success, so a *different* process
   *  that races past our loaded-state check still lands here on the next
   *  load rather than crashing.) */
  | { readonly outcome: 'already-refunded' }
  /** `428 insufficient_money_for_refund` — a business state, not a bug
   *  (research sec.5): the shop's account has no funds *right now*. The
   *  deposit stays `settled` and the refund keeps waiting for the Phase 6
   *  retry queue with backoff — never lost, never retried in a tight loop. */
  | { readonly outcome: 'pending-insufficient-funds' };

/**
 * The money-resolution half of `client-booking: Cancelación del cliente
 * con reembolso automático` (cancellation within the window) and
 * `slot-hold: Hold vencido con cobro asociado` (origin appointment's seña
 * refunded when an absence-offer hold expires). Phase 9 (web cancellation)
 * and Phase 6 (`hold.expire` job) own the window gate and the slot
 * transition; this use case only moves the money, ready to be plugged into
 * either caller.
 *
 * Loudness rules (`Lost payments must be loud`):
 *   - `no-deposit` / `already-refunded` are explicit outcomes, not errors —
 *     the caller knows no money moved and why.
 *   - `pending-insufficient-funds` is an explicit outcome precisely so the
 *     Phase 6 scheduler can apply backoff + never retry forever in-turn.
 *   - any other gateway error re-throws: harder failures surface to the
 *     caller instead of being swallowed.
 */
export class RefundUseCase {
  constructor(
    private readonly deposits: DepositRepository,
    private readonly paymentPort: PaymentPort,
  ) {}

  async execute(_input: RefundInput): Promise<RefundOutcome> {
    throw new Error('RefundUseCase.execute not implemented yet — task 5.20');
  }
}
