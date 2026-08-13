import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookSignatureInput {
  readonly xSignature: string | undefined;
  readonly xRequestId: string | undefined;
  /** The raw `data.id` query param, exactly as MercadoPago sent it. */
  readonly dataId: string;
  readonly secret: string;
}

const SIGNATURE_HEADER_PATTERN = /ts=([^,]+),v1=([0-9a-f]+)/i;

/**
 * `research/mercadopago-api.md` (task 5.1): three details that silently
 * break validation if missed. `data.id` is lowercased before hashing (it
 * arrives as a URL query param); each manifest segment is OMITTED when its
 * source value is absent, but the trailing `;` always stays — so a missing
 * `x-request-id` produces `id:123;ts:170...;`, never `id:123;request-id:;ts:...;`.
 */
function buildManifest(dataId: string, requestId: string | undefined, ts: string): string {
  const idPart = `id:${dataId.toLowerCase()};`;
  const requestIdPart = requestId ? `request-id:${requestId};` : '';
  const tsPart = `ts:${ts};`;
  return `${idPart}${requestIdPart}${tsPart}`;
}

/**
 * Verifies MercadoPago's `x-signature` header. Comparison is timing-safe
 * (`crypto.timingSafeEqual`) on purpose — a plain `===` leaks the correct
 * signature one byte at a time through response timing, which is exactly
 * the threat-matrix's "payload approved falsificado" scenario.
 */
export function verifyMercadoPagoSignature(input: WebhookSignatureInput): boolean {
  if (!input.xSignature) {
    return false;
  }
  const match = SIGNATURE_HEADER_PATTERN.exec(input.xSignature);
  if (!match) {
    return false;
  }
  const ts = match[1];
  const receivedHex = match[2];
  if (ts === undefined || receivedHex === undefined) {
    return false;
  }

  const manifest = buildManifest(input.dataId, input.xRequestId, ts);
  const expectedHex = createHmac('sha256', input.secret).update(manifest).digest('hex');

  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(receivedHex, 'hex');
  if (expected.length !== received.length) {
    return false;
  }
  return timingSafeEqual(expected, received);
}
