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

  // cablear-el-mvp item 2: without these three fields, MercadoPago never
  // sends the client back after paying and never calls our webhook — the
  // appointment stays `held` forever even though the money moved.
  it('includes back_urls/auto_return/notification_url built from PUBLIC_BASE_URL when configured', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'pref-1', init_point: 'https://mp.example/checkout/pref-1' }), {
        status: 201,
      }),
    );
    const adapter = new MercadoPagoPaymentAdapter('token-123', BASE_URL, 'https://duct-making-grid.ngrok-free.dev');

    await adapter.createPreference({
      externalReference: 'hold-1',
      amountCents: 250000,
      description: 'Corte clasico',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.back_urls).toEqual({
      success: 'https://duct-making-grid.ngrok-free.dev/pago/retorno?estado=success',
      pending: 'https://duct-making-grid.ngrok-free.dev/pago/retorno?estado=pending',
      failure: 'https://duct-making-grid.ngrok-free.dev/pago/retorno?estado=failure',
    });
    expect(body.auto_return).toBe('approved');
    expect(body.notification_url).toBe('https://duct-making-grid.ngrok-free.dev/api/webhooks/mercadopago');
  });

  // The exact regression this task warns about: a broken localhost URL sent
  // to MercadoPago is rejected outright, so unset MUST omit these fields
  // rather than guess a default — every test above this one already proves
  // the adapter still works with no third argument at all.
  it('omits back_urls/auto_return/notification_url when PUBLIC_BASE_URL is not configured', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'pref-1', init_point: 'https://mp.example/checkout/pref-1' }), {
        status: 201,
      }),
    );
    const adapter = new MercadoPagoPaymentAdapter('token-123', BASE_URL);

    await adapter.createPreference({
      externalReference: 'hold-1',
      amountCents: 250000,
      description: 'Corte clasico',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.back_urls).toBeUndefined();
    expect(body.auto_return).toBeUndefined();
    expect(body.notification_url).toBeUndefined();
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

  // Task 5.20 — research/mercadopago-api.md sec.4: `X-Idempotency-Key` is
  // REQUIRED (`400 empty_required_header` without it) and must be STABLE
  // between retries of the same logical refund — the gateway's authority on
  // "the same refund, don't issue it twice". For Phase 5b the seña refund is
  // indivisible and uniquely identified by the paymentId (same key ⇒ same
  // refund), so paymentId alone is the stable identity here; Phase 6 will
  // refine the derivation to `deposit_id + motive` per research sec.4.
  it('refund() issues POST /v1/payments/{id}/refunds with a stable X-Idempotency-Key = paymentId', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 4242 }), { status: 201 }));
    const adapter = new MercadoPagoPaymentAdapter('token-123', BASE_URL);

    const result = await adapter.refund({ paymentId: 'pay-9', amountCents: 250000 });

    expect(result).toEqual({ refundId: '4242' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/v1/payments/pay-9/refunds`);
    expect(init.method).toBe('POST');
    expect(init.headers['X-Idempotency-Key']).toBe('pay-9');
  });

  // Research sec.5 — the BLOCKING edge case this task explicitly names: 428
  // `insufficient_money_for_refund` is a BUSINESS STATE (owner withdrew,
  // client cancels). It MUST NOT crash as a generic gateway error — the
  // caller (RefundUseCase) needs to recognize it as the loud, retriable,
  // not-lost signal `InsufficientMoneyForRefundError`.
  it('refund() throws InsufficientMoneyForRefundError on 428, not MercadoPagoApiError', async () => {
    const { InsufficientMoneyForRefundError } = await import('@jc-barberia/domain');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'insufficient_money_for_refund' }), { status: 428 }),
    );
    const adapter = new MercadoPagoPaymentAdapter('token-123', BASE_URL);

    await expect(adapter.refund({ paymentId: 'pay-10', amountCents: 250000 })).rejects.toBeInstanceOf(
      InsufficientMoneyForRefundError,
    );
  });

  // Research sec.5 — `409 order_already_refunded` "No es error: es el
  // resultado esperado de un reintento." Treat it as idempotent SUCCESS so
  // a retried refund surfaces as a RefundResult instead of an error throw —
  // and never double-refunds at the caller's level.
  it('refund() treats 409 order_already_refunded as idempotent success, returning a RefundResult', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'already refunded', error: 'order_already_refunded', id: 4242 }), {
        status: 409,
      }),
    );
    const adapter = new MercadoPagoPaymentAdapter('token-123', BASE_URL);

    const result = await adapter.refund({ paymentId: 'pay-11', amountCents: 250000 });

    expect(result.refundId).toBeDefined();
  });
});
