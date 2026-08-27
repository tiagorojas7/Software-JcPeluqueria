import {
  FakeAppointmentRepository,
  FakeClock,
  FakeDepositRepository,
  FakeHoldExpireViewRepository,
  FakeNotificationOutboxRepository,
  FakePaymentPort,
  InsufficientMoneyForRefundError,
  type Appointment,
  type ExpiredHoldView,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ExpireHold } from './hold-expire';
import { RefundUseCase } from '../payments/refund';

// Instants come from the Clock port, never a raw Date — the lint rule that
// forbids it is what keeps every time value in this project on the shop's
// fixed offset instead of the machine's.
const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

// Phase 6.4 — design.md line 144: `hold.expire` exists only for the effects
// that can never be lazy (refund the settled origin seña + send the
// cancellation notification). The slot liberation is lazy; task 12.10/12.11
// (barber-absence-reassignment) extends this suite to also pin the ORIGIN
// appointment's transition to `cancelado` — the second half of that Phase's
// "Rechazo o falta de respuesta cancela el turno original" requirement, this
// time triggered by the hold's own expiry job rather than a human rejection.
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

  const anOriginAppointment = (overrides: Partial<Appointment> = {}): Appointment => ({
    id: ORIGIN,
    barberId: 'barber-absent',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'web',
    timeRange: { start: at('10:00'), end: at('10:30') },
    status: 'reservado',
    deposit: { kind: 'not_applicable' },
    ...overrides,
  });

  it('refunds the settled origin seña, sends a cancellation-with-refund notification, AND cancels the origin turno when the hold is actionable', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedSettledAppointment(ORIGIN, {
      depositId: 'd-1',
      paymentId: 'mp-1',
      amountCents: 250000,
    });
    const refund = new RefundUseCase(deposits, new FakePaymentPort());
    const outbox = new FakeNotificationOutboxRepository();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView());
    const appointments = new FakeAppointmentRepository();
    appointments.seed(anOriginAppointment({ deposit: { kind: 'settled', paymentId: 'mp-1', amountCents: 250000 } }));
    const useCase = new ExpireHold(views, refund, outbox, appointments);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('refunded-and-notified');
    expect(deposits.findCalls).toEqual([ORIGIN]);
    // Al outbox, nunca directo al transporte: si el mail se cae despues de
    // que la plata volvio, el reintento del job encuentra 'already-refunded'
    // y NO reintenta la notificacion — el cliente no se entera nunca de su
    // reembolso. La entrega con reintentos es del consumidor del outbox.
    expect(outbox.enqueued).toEqual([
      {
        notificationType: 'cancellation_with_refund',
        recipientEmail: EMAIL,
        payload: { refundId: 'fake-refund-1', amountCents: '250000' },
      },
    ]);
    // 12.10/12.11 — the origin turno MUST transition to cancelado, not just
    // have its seña refunded.
    expect(appointments.updateStatusCalls).toEqual([{ id: ORIGIN, status: 'cancelado' }]);
  });

  // Idempotency gate 1 — the rows left `held` (confirmed / rejected payment /
  // lazy liberation / a prior run that already resolved it, OR the client
  // ACCEPTED this exact offer via AcceptOfferUseCase, which releases the hold
  // as part of accepting). A retried job MUST NOT refund, notify, or cancel.
  it('is a no-op when the hold is no longer held (idempotent retry)', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedSettledAppointment(ORIGIN, {
      depositId: 'd-1',
      paymentId: 'mp-1',
      amountCents: 250000,
    });
    const refund = new RefundUseCase(deposits, new FakePaymentPort());
    const outbox = new FakeNotificationOutboxRepository();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView({ isHeld: false }));
    const appointments = new FakeAppointmentRepository();
    const useCase = new ExpireHold(views, refund, outbox, appointments);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('no-op');
    expect(deposits.findCalls).toEqual([]);
    expect(outbox.enqueued).toEqual([]);
    expect(appointments.updateStatusCalls).toEqual([]);
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
    const outbox = new FakeNotificationOutboxRepository();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView({ paymentPending: true }));
    const appointments = new FakeAppointmentRepository();
    const useCase = new ExpireHold(views, refund, outbox, appointments);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('no-op');
    expect(deposits.findCalls).toEqual([]);
    expect(outbox.enqueued).toEqual([]);
    expect(appointments.updateStatusCalls).toEqual([]);
  });

  // A plain (non-absence-offer) hold that lapses: no origin to refund, no
  // seña associated, nothing to notify, nothing to cancel — the lazy path
  // frees the slot. This branches before RefundUseCase is ever asked, so the
  // money side did nothing.
  it('is a no-op for an expired hold without an origin occupancy', async () => {
    const deposits = new FakeDepositRepository();
    const refund = new RefundUseCase(deposits, new FakePaymentPort());
    const outbox = new FakeNotificationOutboxRepository();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView({ originOccupancyId: null }));
    const appointments = new FakeAppointmentRepository();
    const useCase = new ExpireHold(views, refund, outbox, appointments);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('no-op');
    expect(deposits.findCalls).toEqual([]);
    expect(outbox.enqueued).toEqual([]);
    expect(appointments.updateStatusCalls).toEqual([]);
  });

  // Idempotency gate 2 — a retry that finds the SAME held row but a seña the
  // gateway already refunded (RefundUseCase flips `refunded` before any HTTP
  // round-trip). No second gateway call, NO second notification. The cancel
  // IS defensively re-attempted (a prior run could have refunded then
  // crashed before cancelling) but is itself a no-op here because the origin
  // is ALREADY cancelado from that prior run.
  it('is a no-op when the origin seña was already refunded (idempotent money + notify), and does not double-cancel an already-cancelled origin', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedRefundedAppointment(ORIGIN, {
      depositId: 'd-1',
      paymentId: 'mp-1',
      amountCents: 250000,
    });
    const refund = new RefundUseCase(deposits, new FakePaymentPort());
    const outbox = new FakeNotificationOutboxRepository();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView());
    const appointments = new FakeAppointmentRepository();
    appointments.seed(anOriginAppointment({ status: 'cancelado' }));
    const useCase = new ExpireHold(views, refund, outbox, appointments);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('no-op');
    expect(deposits.findCalls).toEqual([ORIGIN]);
    expect(outbox.enqueued).toEqual([]);
    expect(appointments.updateStatusCalls).toEqual([]);
  });

  // 428 business state (research sec.5): the gateway has no funds right now.
  // This is NOT lost and NOT a tight loop — the handler returns `'retry'`,
  // which the pg-boss wiring next slice turns into a backoff requeue. The
  // notification MUST NOT fire because the refund did not move, and the
  // origin MUST NOT be cancelled while its refund is still unresolved.
  it('returns retry and skips the notification AND the cancel when the gateway reports insufficient funds', async () => {
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
    const outbox = new FakeNotificationOutboxRepository();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView());
    const appointments = new FakeAppointmentRepository();
    appointments.seed(anOriginAppointment({ deposit: { kind: 'settled', paymentId: 'mp-1', amountCents: 250000 } }));
    const useCase = new ExpireHold(views, refund, outbox, appointments);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('retry');
    expect(outbox.enqueued).toEqual([]);
    expect(appointments.updateStatusCalls).toEqual([]);
  });

  // 12.10 RED — derived from specs/barber-absence-reassignment/spec.md:
  //
  //   "Requirement: Rechazo o falta de respuesta cancela el turno original"
  //   "Si el cliente rechaza todas las ofertas o no responde dentro de la
  //   ventana del hold, el sistema MUST transicionar el turno original a
  //   `cancelado`. Si el turno original tenía seña ... si no tenía seña
  //   (turno telefónico), no corresponde ninguna acción de reembolso."
  //
  //   Scenario "El cliente no responde, sin seña previa":
  //     GIVEN una oferta activa para un turno original telefónico, sin seña
  //     WHEN transcurren los 15 minutos sin respuesta
  //     THEN el turno original pasa a `cancelado`
  //     AND el sistema no ejecuta ninguna acción de reembolso, porque no
  //     había seña que devolver
  it('cancels a no-seña origin turno when its offer hold lapses unconfirmed — no refund action executes', async () => {
    const deposits = new FakeDepositRepository();
    deposits.seedNotApplicableAppointment(ORIGIN);
    const refund = new RefundUseCase(deposits, new FakePaymentPort());
    const outbox = new FakeNotificationOutboxRepository();
    const views = new FakeHoldExpireViewRepository();
    views.seed(aView({ originClientEmail: null }));
    const appointments = new FakeAppointmentRepository();
    appointments.seed(anOriginAppointment({ channel: 'telefonico', deposit: { kind: 'not_applicable' } }));
    const useCase = new ExpireHold(views, refund, outbox, appointments);

    const outcome = await useCase.execute(HOLD);

    expect(outcome).toBe('cancelled-no-refund');
    expect(appointments.updateStatusCalls).toEqual([{ id: ORIGIN, status: 'cancelado' }]);
    // No seña existed — nothing for PaymentPort/RefundUseCase to move.
    expect(outbox.enqueued).toEqual([]);
  });
});
