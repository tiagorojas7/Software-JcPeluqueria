import { useState, type FormEvent } from 'react';
import type { ShopRevenueResponse } from '@jc-barberia/contracts';

import { apiGet, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';
import './ShopRevenuePage.css';

const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

function formatCents(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

export interface ShopRevenuePageProps {
  readonly actor: Actor | null;
}

/**
 * "Facturación del local" (docs/HUECOS-BACKEND.md #5). This screen was a
 * placeholder behind a real nav item and a real permission for as long as
 * `finance:read:shop` had no controller; `GET /shop/revenue` exists now.
 *
 * Everything here is theoretical revenue at list price, which is the only
 * thing the domain can compute — the system never sees the other 50% taken
 * at the counter. The server's own `disclaimer` is rendered VERBATIM rather
 * than paraphrased, the same posture `RevenueSummary` already takes: the
 * README is explicit that an ambiguous figure is what starts arguments, and
 * this is the figure the owner will quote.
 */
export function ShopRevenuePage({ actor }: ShopRevenuePageProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [revenue, setRevenue] = useState<ShopRevenueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      const response = await apiGet<ShopRevenueResponse>(`/shop/revenue?${params.toString()}`);
      setRevenue(response);
    } catch (err) {
      setError(describeError(err));
      // Cleared on purpose: leaving the previous period's numbers on screen
      // next to a failed request invites reading them as this period's.
      setRevenue(null);
    }
  }

  if (!actor) {
    return (
      <section className="panel-page">
        <h2>Facturación del local</h2>
        <p className="empty-state">Iniciá sesión como dueño para ver esta pantalla.</p>
      </section>
    );
  }

  // Derived rather than requested: it is exactly total / count, and an
  // endpoint for it would be a third number to keep in step with the two it
  // comes from. Guarded because a period with no cuts is a real answer.
  const averageCents = revenue && revenue.count > 0 ? revenue.totalListPriceCents / revenue.count : null;

  /** The busiest barber's revenue, so every bar is drawn relative to the
   *  same maximum instead of each one to itself. */
  const topBarberCents = revenue?.byBarber.reduce((max, row) => Math.max(max, row.totalListPriceCents), 0) ?? 0;
  const topServiceCents = revenue?.byService.reduce((max, row) => Math.max(max, row.totalListPriceCents), 0) ?? 0;

  return (
    <section className="panel-page shop-revenue">
      <h2>Facturación del local</h2>

      {error && <p role="alert">{error}</p>}

      <form className="card panel-page__form shop-revenue__period" onSubmit={handleLoad}>
        <label htmlFor="shop-revenue-from">Desde</label>
        <input id="shop-revenue-from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />

        <label htmlFor="shop-revenue-to">Hasta</label>
        <input id="shop-revenue-to" type="date" required value={to} onChange={(e) => setTo(e.target.value)} />

        <button type="submit">Ver facturación</button>
      </form>

      {!revenue && !error && (
        <p className="empty-state">Elegí un período para ver la facturación teórica del local.</p>
      )}

      {revenue && (
        <>
          <div className="shop-revenue__figures">
            <div className="card shop-revenue__figure shop-revenue__figure--total">
              <span className="shop-revenue__figure-label">Facturación teórica</span>
              <strong className="shop-revenue__figure-value">{formatCents(revenue.totalListPriceCents)}</strong>
              <span className="shop-revenue__figure-note">Suma de los turnos realizados a precio de lista</span>
            </div>
            <div className="card shop-revenue__figure">
              <span className="shop-revenue__figure-label">Cortes realizados</span>
              <strong className="shop-revenue__figure-value">{revenue.count}</strong>
            </div>
            <div className="card shop-revenue__figure">
              <span className="shop-revenue__figure-label">Ticket promedio</span>
              <strong className="shop-revenue__figure-value">
                {averageCents === null ? '—' : formatCents(averageCents)}
              </strong>
            </div>
          </div>

          <p className="shop-revenue__disclaimer">{revenue.disclaimer}</p>

          <section className="card shop-revenue__breakdown" aria-labelledby="shop-revenue-by-barber">
            <h3 id="shop-revenue-by-barber">Por barbero</h3>
            {revenue.byBarber.length === 0 ? (
              <p className="empty-state">Ningún barbero registró cortes en este período.</p>
            ) : (
              <ul className="shop-revenue__rows">
                {revenue.byBarber.map((row) => (
                  <li key={row.barberId} className="shop-revenue__row">
                    <span className="shop-revenue__row-name">{row.barberName}</span>
                    <span className="shop-revenue__row-count">{row.count} cortes</span>
                    <span className="shop-revenue__row-total">{formatCents(row.totalListPriceCents)}</span>
                    <span
                      className="shop-revenue__bar"
                      style={{
                        // Relative to the busiest barber, not to the shop
                        // total: comparing colleagues is what this list is
                        // for, and against the total every bar is a sliver.
                        ['--share' as string]:
                          topBarberCents > 0 ? `${(row.totalListPriceCents / topBarberCents) * 100}%` : '0%',
                      }}
                      aria-hidden="true"
                    />
                  </li>
                ))}
              </ul>
            )}
            <p className="shop-revenue__note">
              Esto es lo que vendieron sus cortes, no es lo que gana cada barbero: el modelo de comisiones todavía
              no está definido en el sistema.
            </p>
          </section>

          <section className="card shop-revenue__breakdown" aria-labelledby="shop-revenue-by-service">
            <h3 id="shop-revenue-by-service">Por servicio</h3>
            {revenue.byService.length === 0 ? (
              <p className="empty-state">No hubo cortes registrados en este período.</p>
            ) : (
              <ul className="shop-revenue__rows">
                {revenue.byService.map((row) => (
                  <li key={row.serviceId} className="shop-revenue__row">
                    <span className="shop-revenue__row-name">{row.serviceName}</span>
                    <span className="shop-revenue__row-count">{row.count} cortes</span>
                    <span className="shop-revenue__row-total">{formatCents(row.totalListPriceCents)}</span>
                    <span
                      className="shop-revenue__bar"
                      style={{
                        ['--share' as string]:
                          topServiceCents > 0 ? `${(row.totalListPriceCents / topServiceCents) * 100}%` : '0%',
                      }}
                      aria-hidden="true"
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
