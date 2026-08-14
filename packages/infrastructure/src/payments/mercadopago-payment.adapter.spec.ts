/* eslint-disable no-undef -- `Response` is a Node 18+ runtime global, not yet
   declared in the shared eslint.config.js globals list (only process/
   console/crypto/performance are). Scoped here rather than editing shared
   config — see apply-progress for the loud report. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MercadoPagoApiError, MercadoPagoPaymentAdapter } from './mercadopago-payment.adapter';

const BASE_URL = 'https://mp.example';

describe('MercadoPagoPaymentAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a preference for the exact deposit amount, carrying the hold id as external_reference', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'pref-1', init_point: 'https://mp.example/checkout/pref-1' }), {
        status: 201,
      }),
    );
    const adapter = new MercadoPagoPaymentAdapter('token-123', BASE_URL);

    const result = await adapter.createPreference({
      externalReference: 'hold-1',
      amountCents: 250000,
      description: 'Corte clasico',
    });

    expect(result).toEqual({ preferenceId: 'pref-1', initPoint: 'https://mp.example/checkout/pref-1' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/checkout/preferences`);
    expect(init.headers.Authorization).toBe('Bearer token-123');
    const body = JSON.parse(init.body);
    expect(body.external_reference).toBe('hold-1');
    expect(body.items[0].unit_price).toBe(2500);
  });

  it('reads a payment status against the single /v1/payments/:id path, never trusting a passed-in status', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ id: 999, status: 'approved', transaction_amount: 2500, external_reference: 'hold-1' }),
        { status: 200 },
      ),
    );
    const adapter = new MercadoPagoPaymentAdapter('token-123', BASE_URL);

    const result = await adapter.getPayment('999');

    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE_URL}/v1/payments/999`);
    expect(result).toEqual({ paymentId: '999', status: 'approved', amountCents: 250000, externalReference: 'hold-1' });
  });

  it('throws MercadoPagoApiError on a non-ok response instead of swallowing it', async () => {
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const adapter = new MercadoPagoPaymentAdapter('bad-token', BASE_URL);

    await expect(adapter.getPayment('1')).rejects.toBeInstanceOf(MercadoPagoApiError);
  });
});
