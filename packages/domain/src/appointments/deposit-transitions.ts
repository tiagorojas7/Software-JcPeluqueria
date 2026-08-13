import type { DepositState } from './deposit-state';
import type { PaymentPort } from './payment-port';

/**
 * Only `not_applicable` and `settled` deposits ever reach these transitions
 * — an appointment only becomes `reservado` with one of those two (web pays
 * up front and lands `settled`; phone/walk-in never carry a deposit at
 * all), so `pending`/`refunded`/`forfeited` showing up here means something
 * upstream is already broken. Failing loudly beats silently doing nothing.
 */
export class UnexpectedDepositStateError extends Error {
  constructor(operation: string, kind: DepositState['kind']) {
    super(
      `"${operation}" cannot run against a deposit in state "${kind}" — only "not_applicable" and "settled" ever reach this transition`,
    );
    this.name = 'UnexpectedDepositStateError';
  }
}

function assertNeverDeposit(value: never): never {
  throw new Error(`Unhandled DepositState kind: ${JSON.stringify(value)}`);
}

/**
 * Marking an appointment `realizado` never moves money, for any deposit
 * kind (appointment-lifecycle spec, "Turno realizado sin seña previa"). A
 * settled deposit is considered applied to the service simply by being left
 * exactly as it is. This function deliberately takes no `PaymentPort` — the
 * signature itself is the proof that this operation cannot charge or
 * refund anything, not just that it happens not to in this implementation.
 */
export function resolveDepositForCompletion(deposit: DepositState): DepositState {
  return deposit;
}

/**
 * A confirmed no-show forfeits a settled deposit. Forfeiting needs no
 * gateway call — the shop simply keeps money it already holds — so, unlike
 * cancellation, this never touches `PaymentPort`. `not_applicable` (a phone
 * booking) is left untouched: there is nothing to forfeit, but the caller
 * (`ConfirmAbsenceUseCase`) still records the absence event itself either
 * way (appointment-lifecycle spec, "Ausencia confirmada sin seña previa").
 */
export function resolveDepositForAbsence(deposit: DepositState): DepositState {
  switch (deposit.kind) {
    case 'not_applicable':
      return deposit;
    case 'settled':
      return { kind: 'forfeited', amountCents: deposit.amountCents };
    case 'pending':
    case 'refunded':
    case 'forfeited':
      throw new UnexpectedDepositStateError('absence', deposit.kind);
    default:
      return assertNeverDeposit(deposit);
  }
}

/**
 * A cancellation refunds a settled deposit automatically through
 * `PaymentPort` (client-booking spec, "Cancelación del cliente con
 * reembolso automático"); `not_applicable` — phone and walk-in channels,
 * the majority case per design.md — never calls it. Not wired into a
 * `CancelUseCase` yet: Phases 9/10 own that orchestration (client- and
 * admin-triggered cancellation respectively). This phase only has to prove
 * the money-resolution half is correct in isolation, ready for them to
 * reuse.
 */
export async function resolveDepositForCancellation(
  deposit: DepositState,
  paymentPort: PaymentPort,
): Promise<DepositState> {
  switch (deposit.kind) {
    case 'not_applicable':
      return deposit;
    case 'settled': {
      const refund = await paymentPort.refund({
        paymentId: deposit.paymentId,
        amountCents: deposit.amountCents,
      });
      return { kind: 'refunded', refundId: refund.refundId, amountCents: deposit.amountCents };
    }
    case 'pending':
    case 'refunded':
    case 'forfeited':
      throw new UnexpectedDepositStateError('cancellation', deposit.kind);
    default:
      return assertNeverDeposit(deposit);
  }
}
