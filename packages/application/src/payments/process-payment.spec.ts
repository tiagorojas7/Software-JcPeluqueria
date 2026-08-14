import { FakeDepositRepository, FakePaymentPort } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ProcessPaymentUseCase } from './process-payment';

describe('ProcessPaymentUseCase', () => {
  // design.md: "El redirect del navegador no es fuente de verdad. El worker
  // consulta GET /v1/payments/:id antes de confirmar."
  it('confirms the hold only after reading the approved status back from MercadoPago', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-1',
      status: 'approved',
      amountCents: 250000,
      externalReference: 'hold-1',
    });
    const deposits = new FakeDepositRepository();
    const useCase = new ProcessPaymentUseCase(paymentPort, deposits);

    const result = await useCase.execute('payment-1');

    expect(result).toEqual({ outcome: 'confirmed' });
    expect(paymentPort.getPaymentCalls).toEqual(['payment-1']);
    expect(deposits.calls).toEqual([{ holdId: 'hold-1', paymentId: 'payment-1', amountCents: 250000 }]);
  });

  // Threat matrix: "reintento del mismo payment_id → cero filas afectadas".
  // Application-layer proof; the atomic database guarantee is
  // DrizzleDepositRepository's own Testcontainers suite.
  it('is idempotent — the second call for the same payment_id is a no-op', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-3',
      status: 'approved',
      amountCents: 250000,
      externalReference: 'hold-3',
    });
    const deposits = new FakeDepositRepository();
    const useCase = new ProcessPaymentUseCase(paymentPort, deposits);

    await useCase.execute('payment-3');
    const retry = await useCase.execute('payment-3');

    expect(retry).toEqual({ outcome: 'already-processed' });
  });

  // Task 5.15 — client-booking spec: "Falla el cobro de la seña". design.md
  // line 152: "Si MercadoPago responde `rejected` o `cancelled`, se libera
  // de inmediato sin esperar los 15 minutos." A `rejected` payment MUST NOT
  // leave the hold `held+payment_pending` (which would freeze the slot past
  // expiry per the 5.18 fix); the worker itself unlocks the slot now.
  it('releases the hold immediately on `rejected` and never records a settled deposit', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-4',
      status: 'rejected',
      amountCents: 250000,
      externalReference: 'hold-4',
    });
    const deposits = new FakeDepositRepository();
    const useCase = new ProcessPaymentUseCase(paymentPort, deposits);

    const result = await useCase.execute('payment-4');

    expect(deposits.calls).toEqual([]); // MUST NOT create the reservado
    expect(deposits.releaseCalls).toEqual([{ holdId: 'hold-4' }]);
    expect(result).toEqual({ outcome: 'released', status: 'rejected' });
  });

  // `cancelled` is the other terminal-failure status design.md calls out by
  // name in the same sentence — same path, same release.
  it('releases the hold immediately on `cancelled` too', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-5',
      status: 'cancelled',
      amountCents: 250000,
      externalReference: 'hold-5',
    });
    const deposits = new FakeDepositRepository();
    const useCase = new ProcessPaymentUseCase(paymentPort, deposits);

    const result = await useCase.execute('payment-5');

    expect(deposits.calls).toEqual([]);
    expect(deposits.releaseCalls).toEqual([{ holdId: 'hold-5' }]);
    expect(result).toEqual({ outcome: 'released', status: 'cancelled' });
  });

  // `pending`/`in_process` are NOT terminal — the payment can still flip to
  // `approved` seconds later. design.md line 150: a hold with a payment in
  // course is "nunca lo libera el temporizador". Releasing here would be the
  // exact race the rule exists to prevent.
  it('leaves the hold untouched on a non-terminal status (pending)', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-6',
      status: 'pending',
      amountCents: 250000,
      externalReference: 'hold-6',
    });
    const deposits = new FakeDepositRepository();
    const useCase = new ProcessPaymentUseCase(paymentPort, deposits);

    const result = await useCase.execute('payment-6');

    expect(deposits.calls).toEqual([]);
    expect(deposits.releaseCalls).toEqual([]);
    expect(result).toEqual({ outcome: 'ignored', status: 'pending' });
  });

  // Idempotency on the rejection side too: a webhook retried for a payment
  // that ended `rejected` fires `payment.process` twice — the second call
  // must observe a no-op, never re-release nor error.
  it('is idempotent on rejection — the second call for the same rejected payment reports no-op', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-7',
      status: 'rejected',
      amountCents: 250000,
      externalReference: 'hold-7',
    });
    const deposits = new FakeDepositRepository();
    const useCase = new ProcessPaymentUseCase(paymentPort, deposits);

    const first = await useCase.execute('payment-7');
    const retry = await useCase.execute('payment-7');

    expect(first).toEqual({ outcome: 'released', status: 'rejected' });
    expect(retry).toEqual({ outcome: 'no-op', status: 'rejected' });
    expect(deposits.releaseCalls).toHaveLength(2); // both calls observed, second affected nothing
  });
});
