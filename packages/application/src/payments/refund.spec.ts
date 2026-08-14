import {
  FakeDepositRepository,
  FakePaymentPort,
  InsufficientMoneyForRefundError,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { RefundUseCase } from './refund';

describe('RefundUseCase', () => {
  // client-booking spec, "Cancelación dentro de la ventana permitida": a
  // reservado web appointment whose seña was settled. Cancelling within the
  // window MUST trigger the automatic refund of the seña AND flip the
  // deposit's state to `refunded`. (The 1-hour window gate itself is Phase 9
  // territory — this use case only owns the money side.)
  it('refunds the settled seña on a client cancellation and persists `refunded`', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedSettledAppointment('appointment-1', {
      depositId: 'deposit-1',
      paymentId: 'mp-payment-1',
      amountCents: 250000,
    });
    const paymentPort = new FakePaymentPort();
    const useCase = new RefundUseCase(deposits, paymentPort);

    const result = await useCase.execute({ appointmentId: 'appointment-1', reason: 'client-cancel' });

    expect(result).toEqual({ outcome: 'refunded', refundId: 'fake-refund-1', amountCents: 250000 });
    expect(paymentPort.refundCalls).toEqual([
      { paymentId: 'mp-payment-1', amountCents: 250000 },
    ]);
    expect(deposits.markRefundedCalls).toEqual([
      { depositId: 'deposit-1', refundId: 'fake-refund-1' },
    ]);
  });

  // slot-hold spec, "Hold vencido con cobro asociado": when an absence-offer
  // hold expires unaccepted, the ORIGIN appointment's settled seña is the
  // "cobro asociado" the system reembolsa. Same money path as cancellation —
  // the only thing that changes is the trigger (`reason`), recorded here for
  // Phase 6's stable-idempotency derivation. The slot transition and
  // notification are the caller's job; this use case only moves the money.
  it('refunds the settled seña when a hold-with-associated-payment expires', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedSettledAppointment('origin-appointment', {
      depositId: 'deposit-2',
      paymentId: 'mp-payment-2',
      amountCents: 250000,
    });
    const paymentPort = new FakePaymentPort();
    const useCase = new RefundUseCase(deposits, paymentPort);

    const result = await useCase.execute({ appointmentId: 'origin-appointment', reason: 'hold-expired' });

    expect(result.outcome).toBe('refunded');
    expect(paymentPort.refundCalls).toHaveLength(1);
    expect(deposits.markRefundedCalls).toEqual([
      { depositId: 'deposit-2', refundId: 'fake-refund-1' },
    ]);
  });

  // design.md "not_applicable": a phone / walk-in cancellation never carries
  // a deposit, so refunding is a no-op that still lets the caller run the
  // rest of the cancellation (notification, slot release). No gateway call,
  // no DB write — the money side did nothing because there was nothing to
  // move.
  it('returns `no-deposit` and never touches the gateway for a not_applicable appointment (phone/walk-in)', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedNotApplicableAppointment('phone-appointment');
    const paymentPort = new FakePaymentPort();
    const useCase = new RefundUseCase(deposits, paymentPort);

    const result = await useCase.execute({ appointmentId: 'phone-appointment', reason: 'client-cancel' });

    expect(result).toEqual({ outcome: 'no-deposit' });
    expect(paymentPort.refundCalls).toEqual([]);
    expect(deposits.markRefundedCalls).toEqual([]);
  });

  // Idempotency: a retried refund for an appointment whose seña was already
  // refunded MUST NOT issue a second gateway call. The loaded `refunded`
  // state short-circuits before `paymentPort.refund` ever runs — exactly the
  // shape `409 order_already_refunded` would otherwise recover from gateway-
  // side, but caught locally before any HTTP round-trip.
  it('is idempotent — a refund request for an already-refunded seña is a no-op, no gateway call', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedRefundedAppointment('appointment-3', {
      depositId: 'deposit-3',
      paymentId: 'mp-payment-3',
      amountCents: 250000,
    });
    const paymentPort = new FakePaymentPort();
    const useCase = new RefundUseCase(deposits, paymentPort);

    const result = await useCase.execute({ appointmentId: 'appointment-3', reason: 'client-cancel' });

    expect(result).toEqual({ outcome: 'already-refunded' });
    expect(paymentPort.refundCalls).toEqual([]);
    expect(deposits.markRefundedCalls).toEqual([]);
  });

  // The 428 business state (research sec.5): the owner withdrew the funds,
  // a client cancels and the refund can't move *right now*. This is NOT a
  // crash and NOT a lost refund — it is an explicit, loud outcome so the
  // Phase 6 retry queue can pick it back up with backoff (never a tight
  // loop), without re-charging the seña and without dropping the refund.
  it('returns `pending-insufficient-funds` and leaves the deposit `settled` on 428', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedSettledAppointment('appointment-4', {
      depositId: 'deposit-4',
      paymentId: 'mp-payment-4',
      amountCents: 250000,
    });
    const paymentPort = new FakePaymentPort();
    paymentPort.refundError = new InsufficientMoneyForRefundError('{"error":"insufficient_money_for_refund"}');
    const useCase = new RefundUseCase(deposits, paymentPort);

    const result = await useCase.execute({ appointmentId: 'appointment-4', reason: 'client-cancel' });

    expect(result).toEqual({ outcome: 'pending-insufficient-funds' });
    expect(paymentPort.refundCalls).toHaveLength(1); // attempted once
    expect(deposits.markRefundedCalls).toEqual([]); // NOT persisted — stays settled
  });

  // Loudness: a refund request against an appointment that does not exist is
  // a caller bug, not a silent no-op. Disappearing this would let a
  // misconfigured caller "successfully" refund appointments that never
  // existed, hiding real breakage.
  it('throws loudly when the appointment id itself does not exist', async () => {
    const deposits = new FakeDepositRepository();
    const paymentPort = new FakePaymentPort();
    const useCase = new RefundUseCase(deposits, paymentPort);

    await expect(
      useCase.execute({ appointmentId: 'ghost-appointment', reason: 'client-cancel' }),
    ).rejects.toThrow();
    expect(paymentPort.refundCalls).toEqual([]);
    expect(deposits.markRefundedCalls).toEqual([]);
  });
});
