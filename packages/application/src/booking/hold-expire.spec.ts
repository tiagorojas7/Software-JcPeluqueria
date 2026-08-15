import {
  FakeDepositRepository,
  FakeHoldExpireViewRepository,
  FakeNotificationPort,
  FakePaymentPort,
  InsufficientMoneyForRefundError,
  type ExpiredHoldView,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ExpireHold } from './hold-expire';
import { RefundUseCase } from '../payments/refund';

// Phase 6.4 — design.md line 144: `hold.expire` exists only for the effects
// that can never be lazy (refund the settled origin seña + send the
// cancellation notification). The slot liberation is lazy and Phase 12 owns
// the origin slot/cancel side; this suite pins the MONEY + NOTIFY contract
// and, crucially, the idempotency that keeps a pg-boss retry honest.
describe('ExpireHold', () => {
  const ORIGIN = 'origin-appointment-1';
  const HOLD = 'hold-1';
  const EMAIL = 'client@example.com';

  const aView = (over: Partial<ExpiredHoldView> = {}): ExpiredHoldView => ({
    holdId: HOLD,
    isHeld: true,
    paymentPending: false,
    originOccupancyId: ORIGIN,
    originClientEmail: EMAIL,
    ...over,
  });

  it('refunds the settled origin seña and sends a cancellation-with-refund notification when the hold is actionable', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedSettledAppointment(ORIGIN, {
      depositId: 'd-1',
      paymentId: 'mp-1',
      amountCents: 250000,
    });
    const refund = new RefundUseCase(deposits, new FakePaymentPort());
    const notifications = new FakeNotificationPort();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView());
    const useCase = new ExpireHold(views, refund, notifications);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('refunded-and-notified');
    expect(deposits.findCalls).toEqual([ORIGIN]);
    expect(notifications.sentMessages).toEqual([
      {
        to: EMAIL,
        template: 'cancellation_with_refund',
        data: { refundId: 'fake-refund-1', amountCents: '250000' },
      },
    ]);
  });

  // Idempotency gate 1 — the rows left `held` (confirmed / rejected payment /
  // lazy liberation / a prior run that already resolved it). A retried job
  // MUST NOT refund or notify again.
  it('is a no-op when the hold is no longer held (idempotent retry)', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedSettledAppointment(ORIGIN, {
      depositId: 'd-1',
      paymentId: 'mp-1',
      amountCents: 250000,
    });
    const refund = new RefundUseCase(deposits, new FakePaymentPort());
    const notifications = new FakeNotificationPort();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView({ isHeld: false }));
    const useCase = new ExpireHold(views, refund, notifications);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('no-op');
    expect(deposits.findCalls).toEqual([]);
    expect(notifications.sentMessages).toEqual([]);
  });

  // Design.md line 150 / 223 — "Regla que elimina el peor caso": a hold with a
  // payment in flight is NEVER acted on by the timer. It waits for
  // ProcessPaymentUseCase's terminal state instead.
  it('is a no-op when the hold has a payment in flight — it waits for a terminal payment state', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedSettledAppointment(ORIGIN, {
      depositId: 'd-1',
      paymentId: 'mp-1',
      amountCents: 250000,
    });
    const refund = new RefundUseCase(deposits, new FakePaymentPort());
    const notifications = new FakeNotificationPort();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView({ paymentPending: true }));
    const useCase = new ExpireHold(views, refund, notifications);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('no-op');
    expect(deposits.findCalls).toEqual([]);
    expect(notifications.sentMessages).toEqual([]);
  });

  // A plain (non-absence-offer) hold that lapses: no origin to refund, no
  // seña associated, nothing to notify — the lazy path frees the slot. This
  // branches before RefundUseCase is ever asked, so the money side did
  // nothing.
  it('is a no-op for an expired hold without an origin occupancy', async () => {
    const deposits = new FakeDepositRepository();
    const refund = new RefundUseCase(deposits, new FakePaymentPort());
    const notifications = new FakeNotificationPort();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView({ originOccupancyId: null }));
    const useCase = new ExpireHold(views, refund, notifications);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('no-op');
    expect(deposits.findCalls).toEqual([]);
    expect(notifications.sentMessages).toEqual([]);
  });

  // Idempotency gate 2 — a retry that finds the SAME held row but a seña the
  // gateway already refunded (RefundUseCase flips `refunded` before any HTTP
  // round-trip). No second gateway call, NO second notification.
  it('is a no-op when the origin seña was already refunded (idempotent money + notify)', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedRefundedAppointment(ORIGIN, {
      depositId: 'd-1',
      paymentId: 'mp-1',
      amountCents: 250000,
    });
    const refund = new RefundUseCase(deposits, new FakePaymentPort());
    const notifications = new FakeNotificationPort();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView());
    const useCase = new ExpireHold(views, refund, notifications);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('no-op');
    expect(deposits.findCalls).toEqual([ORIGIN]);
    expect(notifications.sentMessages).toEqual([]);
  });

  // 428 business state (research sec.5): the gateway has no funds right now.
  // This is NOT lost and NOT a tight loop — the handler returns `'retry'`,
  // which the pg-boss wiring next slice turns into a backoff requeue. The
  // notification MUST NOT fire because the refund did not move.
  it('returns retry and skips the notification when the gateway reports insufficient funds', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedSettledAppointment(ORIGIN, {
      depositId: 'd-1',
      paymentId: 'mp-1',
      amountCents: 250000,
    });
    const paymentPort = new FakePaymentPort();
    paymentPort.refundError = new InsufficientMoneyForRefundError(
      '{"error":"insufficient_money_for_refund"}',
    );
    const refund = new RefundUseCase(deposits, paymentPort);
    const notifications = new FakeNotificationPort();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView());
    const useCase = new ExpireHold(views, refund, notifications);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('retry');
    expect(notifications.sentMessages).toEqual([]);
  });
});
