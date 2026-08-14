import {
  InsufficientMoneyForRefundError,
  UnexpectedDepositStateError,
  type DepositRepository,
  type PaymentPort,
} from '@jc-barberia/domain';

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

  async execute(input: RefundInput): Promise<RefundOutcome> {
    const loaded = await this.deposits.findDepositForAppointment(input.appointmentId);
    if (!loaded) {
      // A refund requested against an appointment that does not exist is a
      // caller bug, not a silent no-op — hiding it would let a misconfigured
      // caller "successfully" refund appointments that never existed.
      throw new Error(
        `RefundUseCase: appointment "${input.appointmentId}" does not exist — refusing to refund a ghost appointment`,
      );
    }

    switch (loaded.state.kind) {
      case 'not_applicable':
        return { outcome: 'no-deposit' };

      case 'refunded':
        return { outcome: 'already-refunded' };

      case 'settled': {
        const { paymentId, amountCents } = loaded.state;
        let refund;
        try {
          refund = await this.paymentPort.refund({ paymentId, amountCents });
        } catch (error) {
          if (error instanceof InsufficientMoneyForRefundError) {
            // 428 — business state, NOT lost, NOT crash, NOT retry-forever:
            // stays settled, Phase 6 picks it back up with backoff.
            return { outcome: 'pending-insufficient-funds' };
          }
          throw error; // louder failures propagate — Phase 6 retry/alert policy
        }
        await this.deposits.markRefunded({ depositId: loaded.depositId!, refundId: refund.refundId });
        return { outcome: 'refunded', refundId: refund.refundId, amountCents };
      }

      // `pending` / `forfeited` should never reach a refund — a `pending`
      // deposit has no money taken yet, and a `forfeited` one was already
      // resolved as the shop keeping it (ausencia confirmada). Surfacing
      // loudly beats silently no-op'ing, exactly like the pure
      // `resolveDepositForCancellation` does.
      case 'pending':
      case 'forfeited':
        throw new UnexpectedDepositStateError('refund', loaded.state.kind);

      default: {
        // TS exhaustiveness guard: any future DepositState kind forces a
        // real decision here instead of falling through silently.
        const _exhaustive: never = loaded.state;
        throw new Error(`RefundUseCase: unhandled DepositState kind ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
