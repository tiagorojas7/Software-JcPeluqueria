import { FakeClock, FakeHoldRepository, FakePaymentPort } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { CheckoutUseCase } from './checkout';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

describe('CheckoutUseCase', () => {
  // client-booking: "Reserva web con seña obligatoria del 50%"
  it('re-validates the hold, extends its expiry and creates a preference for half the list price', async () => {
    const clock = new FakeClock(-180, at('09:45'));
    const holds = new FakeHoldRepository(true, true);
    const paymentPort = new FakePaymentPort();
    const useCase = new CheckoutUseCase(holds, paymentPort, clock);

    const result = await useCase.execute({
      holdId: 'hold-1',
      priceCents: 500000,
      description: 'Corte clasico',
    });

    expect(result).toEqual({
      outcome: 'created',
      initPoint: 'https://mercadopago.example/fake-preference-1',
      preferenceId: 'fake-preference-1',
    });
    expect(holds.beginCheckoutCalls).toEqual([{ holdId: 'hold-1', paymentExpiresAt: at('10:00') }]);
    expect(paymentPort.createPreferenceCalls).toEqual([
      { externalReference: 'hold-1', amountCents: 250000, description: 'Corte clasico' },
    ]);
  });

  it('never calls MercadoPago when re-validation fails — the hold already expired', async () => {
    const clock = new FakeClock(-180, at('09:45'));
    const holds = new FakeHoldRepository(true, false);
    const paymentPort = new FakePaymentPort();
    const useCase = new CheckoutUseCase(holds, paymentPort, clock);

    const result = await useCase.execute({
      holdId: 'hold-1',
      priceCents: 500000,
      description: 'Corte clasico',
    });

    expect(result).toEqual({ outcome: 'hold-expired' });
    expect(paymentPort.createPreferenceCalls).toEqual([]);
  });
});
