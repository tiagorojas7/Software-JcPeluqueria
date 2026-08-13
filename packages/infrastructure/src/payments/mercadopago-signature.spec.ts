import { describe, expect, it } from 'vitest';

import { verifyMercadoPagoSignature } from './mercadopago-signature';

const SECRET = 'test-secret';

// Vectors computed independently with node:crypto against the exact manifest
// template from research/mercadopago-api.md — id:{data.id};request-id:{x-request-id};ts:{ts};
const VALID_WITH_REQUEST_ID =
  'e9a39bbdd481339f443a07c1c3d7f4fd07f3bb23ec03ae625222043493c25d3f';
const VALID_WITHOUT_REQUEST_ID =
  '27b230229e464f2ae25dde122237abf312ea5963a73c8985831b39730f186cc7';
const VALID_LOWERCASED_DATA_ID =
  '97f34dc219ad10048b74c09374dc912bef954874067beedccb5eb366743534bf';

describe('verifyMercadoPagoSignature — threat matrix (webhook público de MercadoPago)', () => {
  it('accepts a correctly computed signature, request-id present', () => {
    const valid = verifyMercadoPagoSignature({
      xSignature: `ts=1700000000,v1=${VALID_WITH_REQUEST_ID}`,
      xRequestId: 'req-1',
      dataId: '123456',
      secret: SECRET,
    });

    expect(valid).toBe(true);
  });

  it('omits the request-id segment but keeps the trailing ";" when x-request-id is absent — not an empty "request-id:;" segment', () => {
    const valid = verifyMercadoPagoSignature({
      xSignature: `ts=1700000000,v1=${VALID_WITHOUT_REQUEST_ID}`,
      xRequestId: undefined,
      dataId: '123456',
      secret: SECRET,
    });

    expect(valid).toBe(true);
  });

  it('lowercases data.id before hashing — it arrives as a URL query param', () => {
    const valid = verifyMercadoPagoSignature({
      xSignature: `ts=1700000000,v1=${VALID_LOWERCASED_DATA_ID}`,
      xRequestId: undefined,
      dataId: 'ABC123',
      secret: SECRET,
    });

    expect(valid).toBe(true);
  });

  it('rejects a tampered v1 hash', () => {
    const valid = verifyMercadoPagoSignature({
      xSignature: `ts=1700000000,v1=${'0'.repeat(64)}`,
      xRequestId: 'req-1',
      dataId: '123456',
      secret: SECRET,
    });

    expect(valid).toBe(false);
  });

  it('rejects a missing x-signature header entirely', () => {
    const valid = verifyMercadoPagoSignature({
      xSignature: undefined,
      xRequestId: 'req-1',
      dataId: '123456',
      secret: SECRET,
    });

    expect(valid).toBe(false);
  });

  it('rejects a malformed x-signature header missing the v1 part', () => {
    const valid = verifyMercadoPagoSignature({
      xSignature: 'ts=1700000000',
      xRequestId: 'req-1',
      dataId: '123456',
      secret: SECRET,
    });

    expect(valid).toBe(false);
  });

  it('rejects a forged "approved" payload signed with the wrong secret — no valid signature, no domain effect', () => {
    const valid = verifyMercadoPagoSignature({
      xSignature: `ts=1700000000,v1=${VALID_WITH_REQUEST_ID}`,
      xRequestId: 'req-1',
      dataId: '123456',
      secret: 'a-completely-different-secret',
    });

    expect(valid).toBe(false);
  });
});
