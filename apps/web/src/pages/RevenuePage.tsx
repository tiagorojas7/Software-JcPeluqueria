import { useState, type FormEvent } from 'react';
import type { BarberRevenueResponse } from '@jc-barberia/contracts';

import { RevenueSummary } from '../barbers/RevenueSummary';
import { apiGet, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';

export interface RevenuePageProps {
  readonly actor: Actor | null;
}

/** barber-profile spec, "Facturación teórica por precio de lista" — needs
 *  `finance:read:own`, so only a barber's own account can load this. */
export function RevenuePage({ actor }: RevenuePageProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [revenue, setRevenue] = useState<BarberRevenueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!actor?.barberId) {
      return;
    }
    try {
      const params = new URLSearchParams({ from, to });
      const response = await apiGet<BarberRevenueResponse>(
        `/barbers/${actor.barberId}/revenue?${params.toString()}`,
      );
      setRevenue(response);
    } catch (err) {
      setError(describeError(err));
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
        <RevenueSummary revenue={revenue} />
      ) : (
        <p className="empty-state">Elegí un período para ver tu facturación teórica.</p>
      )}
    </section>
  );
}
