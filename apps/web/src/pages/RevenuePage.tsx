import { useState, type FormEvent } from 'react';
import type { BarberRevenueResponse, BarberStatsResponse } from '@jc-barberia/contracts';

import { RevenueSummary } from '../barbers/RevenueSummary';
import { apiGet, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';
import './RevenuePage.css';

export interface RevenuePageProps {
  readonly actor: Actor | null;
}

/** barber-profile spec, "Facturación teórica por precio de lista" — needs
 *  `finance:read:own`, so only a barber's own account can load this. */
export function RevenuePage({ actor }: RevenuePageProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [revenue, setRevenue] = useState<BarberRevenueResponse | null>(null);
  const [stats, setStats] = useState<BarberStatsResponse | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!actor?.barberId) {
      return;
    }
    const params = new URLSearchParams({ from, to });
    try {
      const response = await apiGet<BarberRevenueResponse>(
        `/barbers/${actor.barberId}/revenue?${params.toString()}`,
      );
      setRevenue(response);
    } catch (err) {
      setError(describeError(err));
      return;
    }

    // The resolution counts come from a separate endpoint behind a separate
    // permission (`agenda:read:own`), so they are fetched — and allowed to
    // fail — separately: a barber who can read their revenue but not their
    // agenda still gets the number they came for. `undefined` means "not
    // loaded", which `RevenueSummary` renders as simply absent, never as
    // zero — a zero would be a lie about a period nobody could query.
    try {
      const response = await apiGet<BarberStatsResponse>(
        `/barbers/${actor.barberId}/stats?${params.toString()}`,
      );
      setStats(response);
    } catch {
      setStats(undefined);
    }
  }

  if (!actor) {
    return (
      <section className="panel-page">
        <h2>Mi facturación</h2>
        <p className="empty-state">Iniciá sesión como barbero para ver esta pantalla.</p>
      </section>
    );
  }

  if (!actor.barberId) {
    return (
      <section className="panel-page">
        <h2>Mi facturación</h2>
        <p className="empty-state">Esta cuenta no tiene un barbero asociado.</p>
      </section>
    );
  }

  return (
    <section className="panel-page">
      <h2>Mi facturación</h2>
      {error && <p role="alert">{error}</p>}
      <form className="card panel-page__form" onSubmit={handleLoad}>
        <label htmlFor="revenue-from">Desde</label>
        <input id="revenue-from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />

        <label htmlFor="revenue-to">Hasta</label>
        <input id="revenue-to" type="date" required value={to} onChange={(e) => setTo(e.target.value)} />

        <button type="submit">Ver facturación</button>
      </form>
      {revenue ? (
        <div className="card revenue-page__summary">
          <RevenueSummary revenue={revenue} stats={stats} />
        </div>
      ) : (
        <p className="empty-state">Elegí un período para ver tu facturación teórica.</p>
      )}
    </section>
  );
}
