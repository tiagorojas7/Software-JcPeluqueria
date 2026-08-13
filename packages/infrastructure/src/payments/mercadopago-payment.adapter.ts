import type {
  CreatePreferenceResult,
  PaymentPort,
  PaymentStatus,
  PaymentStatusResult,
  RefundResult,
} from '@jc-barberia/domain';

const DEFAULT_BASE_URL = 'https://api.mercadopago.com';

/**
 * `research/mercadopago-api.md` (task 5.1) left ONE decision unresolved:
 * whether Checkout Pro refunds go through the Payments API or the Orders
 * API. Isolating it to this single constant — not scattered across call
 * sites — is what keeps that decision cheap to flip later, per design.md's
 * "un solo adaptador con la ruta base en un solo lugar".
 */
const REFUND_PATH = (paymentId: string): string => `/v1/payments/${paymentId}/refunds`;

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
    const response = await this.request<{ id: number }>(REFUND_PATH(input.paymentId), { method: 'POST' });
    return { refundId: String(response.id) };
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
