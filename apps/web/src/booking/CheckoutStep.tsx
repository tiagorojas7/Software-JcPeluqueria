import type { CheckoutResponseBody } from '@jc-barberia/contracts';

export interface CheckoutStepProps {
  /** `null` until the visitor asks to start checkout. Mirrors the exact
   *  `POST /holds/checkout` response body (task 9.11/9.12) — never a locally
   *  invented status, so this component cannot drift from what the backend
   *  actually decided. */
  readonly checkout: CheckoutResponseBody | null;
  readonly onStartCheckout: () => void;
}

/**
 * client-booking spec, "Reserva web con seña obligatoria del 50%" +
 * "Falla el cobro de la seña" (task 9.12): starts checkout and, on success,
 * hands the visitor the gateway link — it NEVER renders the turno as
 * `reservado`, because this response is not that confirmation. Per
 * design.md, "el redirect del navegador no es fuente de verdad": the real
 * `reservado` transition only ever happens inside `ProcessPaymentUseCase`,
 * driven by MercadoPago's webhook, entirely outside this component's view.
 *
 * On `hold-expired` this offers no retry, no link, nothing that suggests the
 * reservation can still complete — same "no fake continuation" shape
 * `AccessCodeForm` (9.10) already established for a dead access code.
 * Purely presentational, same container/presentational split as every other
 * booking component: it never calls the checkout endpoint itself.
 */
export function CheckoutStep({ checkout, onStartCheckout }: CheckoutStepProps) {
  if (checkout?.outcome === 'created') {
    return (
      <div>
        <p>Te vamos a redirigir a MercadoPago para pagar la seña.</p>
        <a href={checkout.initPoint}>Pagar la seña ahora</a>
      </div>
    );
  }

  if (checkout?.outcome === 'hold-expired') {
    return (
      <div role="alert">
        El horario retenido ya venció. Volvé a elegir un horario para continuar.
      </div>
    );
  }

  return (
    <button type="button" onClick={onStartCheckout}>
      Pagar la seña (50%)
    </button>
  );
}
