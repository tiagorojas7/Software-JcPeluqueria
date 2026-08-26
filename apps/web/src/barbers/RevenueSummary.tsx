import type { BarberRevenueResponse } from '@jc-barberia/contracts';

export interface RevenueSummaryProps {
  readonly revenue: BarberRevenueResponse;
  /**
   * How many `realizado` turnos produced this total, from
   * `GET /barbers/:barberId/stats`.
   *
   * Optional because it arrives from a SECOND request: if that one fails the
   * barber still gets the number they came for, minus the count.
   */
  readonly cutCount?: number;
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
export function RevenueSummary({ revenue, cutCount }: RevenueSummaryProps) {
  // Derived rather than requested: the average per cut is exactly
  // total / count, and an endpoint for it would be a third number to keep in
  // step with the two it comes from. Guarded because a period with no cuts
  // is a real answer, and `0 / 0` renders as NaN.
  const averageCents =
    cutCount !== undefined && cutCount > 0 ? revenue.totalListPriceCents / cutCount : null;

  return (
    <section aria-label="Facturación propia">
      <p className="revenue-summary__total">
        {currencyFormatter.format(revenue.totalListPriceCents / 100)}
      </p>

      {cutCount !== undefined ? (
        <dl className="revenue-summary__figures">
          <div>
            <dt>Cortes realizados</dt>
            <dd>{cutCount}</dd>
          </div>
          {averageCents !== null ? (
            <div>
              <dt>Promedio por corte</dt>
              <dd>{currencyFormatter.format(averageCents / 100)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <p className="revenue-summary__disclaimer">{revenue.disclaimer}</p>
    </section>
  );
}
