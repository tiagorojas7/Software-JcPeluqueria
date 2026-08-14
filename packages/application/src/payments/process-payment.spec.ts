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

  it('never touches the deposit repository for a non-approved status', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-2',
      status: 'rejected',
      amountCents: 250000,
      externalReference: 'hold-2',
    });
    const deposits = new FakeDepositRepository();
    const useCase = new ProcessPaymentUseCase(paymentPort, deposits);

    const result = await useCase.execute('payment-2');

    expect(result).toEqual({ outcome: 'ignored', status: 'rejected' });
    expect(deposits.calls).toEqual([]);
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
});
