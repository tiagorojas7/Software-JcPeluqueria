import type {
  CreatePreferenceResult,
  PaymentPort,
  PaymentStatus,
  PaymentStatusResult,
  RefundResult,
} from '@jc-barberia/domain';
import { InsufficientMoneyForRefundError } from '@jc-barberia/domain';

const DEFAULT_BASE_URL = 'https://api.mercadopago.com';

/**
 * `research/mercadopago-api.md` (task 5.1) left ONE decision unresolved:
 * whether Checkout Pro refunds go through the Payments API or the Orders
 * API. Isolating it to this single constant — not scattered across call
 * sites — is what keeps that decision cheap to flip later, per design.md's
 * "un solo adaptador con la ruta base en un solo lugar".
 */
const REFUND_PATH = (paymentId: string): string => `/v1/payments/${paymentId}/refunds`;

/**
 * Best-effort retrieval of a refund id from a `409 order_already_refunded`
 * body, for the idempotent-success branch of `refund()`. MercadoPago's
 * refund response shape varies (single object with `id`, an array of
 * refunds, just an error wrapper), so this parses defensively and signals
 * "not found" with `null` — the caller then falls back to the stable
 * `'already-refunded'` marker. Never throws on a malformed body: a refund
 * that already succeeded must not crash because the audit body wasn't
 * what we expected.
 */
const extractRefundId = (body: string): string | null => {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) {
      if (typeof parsed.id === 'number') return String(parsed.id);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0]?.id === 'number') {
        return String(parsed[0].id);
      }
    }
  } catch {
    // Malformed body — fall back to the marker, don't crash on a refund.
  }
  return null;
};

export class MercadoPagoApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`MercadoPago API error ${status}: ${body}`);
    this.name = 'MercadoPagoApiError';
  }
}

/**
 * The ONLY place that talks HTTP to MercadoPago — every endpoint path lives
 * here, behind one `request()` helper and one `baseUrl`. `createPreference`
 * sets `external_reference` to the hold id so `getPayment` can hand it back
 * to the caller without the webhook payload needing to carry it.
 */
export class MercadoPagoPaymentAdapter implements PaymentPort {
  constructor(
    private readonly accessToken: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async createPreference(input: {
    externalReference: string;
    amountCents: number;
    description: string;
  }): Promise<CreatePreferenceResult> {
    const response = await this.request<{ id: string; init_point: string }>('/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          {
            title: input.description,
            quantity: 1,
            currency_id: 'ARS',
            unit_price: input.amountCents / 100,
          },
        ],
        external_reference: input.externalReference,
      }),
    });
    return { preferenceId: response.id, initPoint: response.init_point };
  }

  async getPayment(paymentId: string): Promise<PaymentStatusResult> {
    const response = await this.request<{
      id: number;
      status: PaymentStatus;
      transaction_amount: number;
      external_reference: string;
    }>(`/v1/payments/${paymentId}`, { method: 'GET' });
    return {
      paymentId: String(response.id),
      status: response.status,
      amountCents: Math.round(response.transaction_amount * 100),
      externalReference: response.external_reference,
    };
  }

  async refund(input: { paymentId: string; amountCents: number }): Promise<RefundResult> {
    // research/mercadopago-api.md sec.4: `X-Idempotency-Key` is REQUIRED by
    // MercadoPago (`400 empty_required_header` without it) and MUST be stable
    // across retries of the same logical refund. The seña refund is total
    // and indivisible (research sec.3 — no partial refunds for this system),
    // so the `paymentId` alone uniquely and stably identifies the refund;
    // Phase 6 will refine the derivation to `deposit_id + motive`.
    // eslint-disable-next-line no-undef
    const response = await fetch(`${this.baseUrl}${REFUND_PATH(input.paymentId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        'X-Idempotency-Key': input.paymentId,
      },
    });

    if (response.ok) {
      const body = (await response.json()) as { id?: number };
      return { refundId: String(body.id) };
    }

    const text = await response.text();

    // research sec.5 — "No es error: es el resultado esperado de un
    // reintento". Treat 409 `order_already_refunded` as idempotent success so
    // a retried refund surfaces as a RefundResult, never a double-refundal.
    if (response.status === 409 && text.includes('order_already_refunded')) {
      return { refundId: extractRefundId(text) ?? 'already-refunded' };
    }

    // research sec.5 — `428 insufficient_money_for_refund` is a BUSINESS
    // STATE, not a program error. Distinct typed throw so the caller
    // (RefundUseCase) returns `pending-insufficient-funds` and lets Phase 6
    // retry with backoff — never lost, never retried in a tight loop.
    if (response.status === 428 && text.includes('insufficient_money_for_refund')) {
      throw new InsufficientMoneyForRefundError(text);
    }

    // All other non-ok responses (401, 422 max_refunds_exceeded, 425 not yet
    // enabled, generic 5xx) surface as the loud MercadoPagoApiError — the
    // caller's retry/alert policy owns them, never silent.
    throw new MercadoPagoApiError(response.status, text);
  }

  // `fetch`/`RequestInit` are Node 18+ runtime globals, not yet in the
  // shared eslint.config.js globals list (only process/console/crypto/
  // performance are declared there). Scoped disable here rather than
  // editing the shared config — see apply-progress for the loud report.
  // eslint-disable-next-line no-undef
  private async request<T>(path: string, init: RequestInit): Promise<T> {
    // eslint-disable-next-line no-undef
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new MercadoPagoApiError(response.status, await response.text());
    }
    return (await response.json()) as T;
  }
}
