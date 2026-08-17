import type { BarberRevenueResponse } from '@jc-barberia/contracts';

export interface RevenueSummaryProps {
  readonly revenue: BarberRevenueResponse;
}

const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

/**
 * barber-profile spec, "Facturación teórica por precio de lista" — task
 * 11.8's "+ etiqueta en la UI". Purely presentational, and deliberately
 * dumb: it renders `revenue.disclaimer` VERBATIM, never a client-authored
 * paraphrase. The backend (`GetOwnRevenueUseCase.REVENUE_DISCLAIMER`) is the
 * one and only source of truth for this legally/financially sensitive
 * wording — see that constant's own doc comment for why a bare number is
 * exactly the gap this component (and its RED test) closes.
 */
export function RevenueSummary({ revenue }: RevenueSummaryProps) {
  return (
    <section aria-label="Facturación propia">
      <p>{currencyFormatter.format(revenue.totalListPriceCents / 100)}</p>
      <p>{revenue.disclaimer}</p>
    </section>
  );
}
