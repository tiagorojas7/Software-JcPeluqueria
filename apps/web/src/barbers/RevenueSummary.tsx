import type { BarberRevenueResponse, BarberStatsResponse } from '@jc-barberia/contracts';

export interface RevenueSummaryProps {
  readonly revenue: BarberRevenueResponse;
  /**
   * How the barber's turnos in this period resolved, from
   * `GET /barbers/:barberId/stats`.
   *
   * Optional because it arrives from a SECOND request behind a SECOND
   * permission (`agenda:read:own`): a barber who can read their revenue but
   * not their agenda still gets the number they came for, minus the counts.
   */
  readonly stats?: BarberStatsResponse;
}

const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

function formatCents(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

/**
 * barber-profile spec, "Facturación teórica por precio de lista" — task
 * 11.8's "+ etiqueta en la UI". Purely presentational, and deliberately
 * dumb: it renders `revenue.disclaimer` VERBATIM, never a client-authored
 * paraphrase. The backend (`GetOwnRevenueUseCase.REVENUE_DISCLAIMER`) is the
 * one and only source of truth for this legally/financially sensitive
 * wording.
 *
 * The bare total was the ambiguous figure the README warns about: it could
 * not say whether a good month came from volume or from pricier services,
 * and it could not explain a bad one. `byService` (HUECOS #3) answers the
 * first and the resolution counts (HUECOS #4) answer the second — five
 * ausentes in a month is the context that stops a barber distrusting their
 * own number.
 */
export function RevenueSummary({ revenue, stats }: RevenueSummaryProps) {
  // Derived rather than requested: the average per cut is exactly
  // total / count, and asking for it would be a third number to keep in step
  // with the two it comes from. Guarded because a period with no cuts is a
  // real answer, and `0 / 0` renders as NaN.
  const averageCents = stats && stats.count > 0 ? revenue.totalListPriceCents / stats.count : null;

  /** The busiest service, so every bar is drawn against the same maximum
   *  instead of each one against itself. */
  const topServiceCents = revenue.byService.reduce((max, row) => Math.max(max, row.totalListPriceCents), 0);

  return (
    <section aria-label="Facturación propia">
      <p className="revenue-summary__total">{formatCents(revenue.totalListPriceCents)}</p>

      {stats ? (
        <dl className="revenue-summary__figures">
          <div>
            <dt>Cortes realizados</dt>
            <dd>{stats.count}</dd>
          </div>
          {averageCents !== null ? (
            <div>
              <dt>Promedio por corte</dt>
              <dd>{formatCents(averageCents)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <p className="revenue-summary__disclaimer">{revenue.disclaimer}</p>

      {revenue.byService.length > 0 ? (
        <section className="revenue-summary__breakdown" aria-labelledby="revenue-by-service">
          <h3 id="revenue-by-service">Por servicio</h3>
          <ul className="revenue-summary__rows">
            {revenue.byService.map((row) => (
              <li key={row.serviceId} className="revenue-summary__row">
                <span className="revenue-summary__row-name">{row.serviceName}</span>
                <span className="revenue-summary__row-count">{row.count} cortes</span>
                <span className="revenue-summary__row-total">{formatCents(row.totalListPriceCents)}</span>
                <span
                  className="revenue-summary__bar"
                  style={{
                    ['--share' as string]:
                      topServiceCents > 0 ? `${(row.totalListPriceCents / topServiceCents) * 100}%` : '0%',
                  }}
                  aria-hidden="true"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {stats ? (
        <section className="revenue-summary__outcomes" aria-labelledby="revenue-outcomes">
          {/* "Realizados" is deliberately absent here: it is already the
              "Cortes realizados" figure at the top, and the same number
              under two names reads as two facts. This block answers the
              other question — what happened to the turnos that did NOT
              become a cut. */}
          <h3 id="revenue-outcomes">Los que no se hicieron</h3>
          <dl className="revenue-summary__outcome-list">
            <div className="revenue-summary__outcome revenue-summary__outcome--cancelado">
              <dt>Cancelados</dt>
              <dd>{stats.cancelledCount}</dd>
            </div>
            <div className="revenue-summary__outcome revenue-summary__outcome--ausente">
              <dt>Ausentes</dt>
              <dd>{stats.absentCount}</dd>
            </div>
            <div className="revenue-summary__outcome revenue-summary__outcome--sin-registrar">
              <dt>Sin registrar</dt>
              <dd>{stats.unresolvedCount}</dd>
            </div>
          </dl>
          <p className="revenue-summary__outcome-note">
            Solo los turnos <strong>realizados</strong> suman a tu facturación. Los que quedaron sin registrar
            todavía no cuentan.
          </p>
        </section>
      ) : null}
    </section>
  );
}
