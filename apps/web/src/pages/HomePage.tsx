import { useEffect, useState } from 'react';
import type { PublicBarberResponse, PublicBarbersResponse, PublicServiceResponse, PublicServicesResponse } from '@jc-barberia/contracts';

import { apiGet, describeError } from '../shared/api-client';
import { formatPriceArs } from '../shared/money';
import { Link } from '../shared/router';
import './HomePage.css';

const STEPS = [
  { title: 'Elegí servicio y barbero', body: 'Corte, barba o los dos juntos, con el barbero que prefieras.' },
  { title: 'Elegí un horario libre', body: 'Vas a ver únicamente los horarios que están realmente disponibles.' },
  { title: 'Pagá la seña y listo', body: 'Una seña del 50% asegura tu lugar. El resto se paga en el local.' },
] as const;

/**
 * D.2 / datos-reales-en-ui: the public landing page (`/`). Used to import
 * `shared/demo-data.ts` — hardcoded barbers/services with prices baked into
 * display strings, never touching the database. Now fetches `GET /barbers`
 * (already active-only server-side, ListPublicBarbersUseCase) and
 * `GET /services` (real `priceCents`, formatted here via `formatPriceArs`)
 * on mount, same `apiGet` every other page uses. A deactivated barber or a
 * changed price is therefore correct here the instant the panel changes it
 * — there is no separate copy of this data left to go stale.
 */
export function HomePage() {
  const [services, setServices] = useState<readonly PublicServiceResponse[] | null>(null);
  const [barbers, setBarbers] = useState<readonly PublicBarberResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [servicesResponse, barbersResponse] = await Promise.all([
          apiGet<PublicServicesResponse>('/services'),
          apiGet<PublicBarbersResponse>('/barbers'),
        ]);
        if (cancelled) {
          return;
        }
        setServices(servicesResponse.services);
        setBarbers(barbersResponse.barbers);
      } catch (err) {
        if (!cancelled) {
          setError(describeError(err));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="home">
      <section className="home__hero">
        <div className="container home__hero-inner">
          <span className="home__eyebrow">Córdoba Capital</span>
          <h1>JC Barbería</h1>
          <p>Cortes prolijos, sin vueltas. Reservá tu turno online en minutos y pagá la seña para asegurar tu lugar.</p>
          <Link to="/reservar" className="home__cta">
            Reservar turno
          </Link>
        </div>
      </section>

      <section className="home__section" aria-labelledby="home-steps-heading">
        <div className="container">
          <h2 id="home-steps-heading">Cómo reservar</h2>
          <ol className="home__steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="home__step">
                <span className="home__step-number">{index + 1}</span>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {error && <p role="alert">{error}</p>}

      <section className="home__section home__section--alt" aria-labelledby="home-services-heading">
        <div className="container">
          <h2 id="home-services-heading">Servicios</h2>
          {services === null && !error && <p className="empty-state">Cargando servicios...</p>}
          {services !== null && services.length === 0 && (
            <p className="empty-state">Todavía no hay servicios cargados.</p>
          )}
          {services !== null && services.length > 0 && (
            <ul className="home__grid">
              {services.map((service) => (
                <li key={service.id} className="home__card">
                  <strong>
                    {service.name} ({formatPriceArs(service.priceCents)})
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="home__section" aria-labelledby="home-team-heading">
        <div className="container">
          <h2 id="home-team-heading">Nuestro equipo</h2>
          {barbers === null && !error && <p className="empty-state">Cargando equipo...</p>}
          {barbers !== null && barbers.length === 0 && (
            <p className="empty-state">Todavía no hay barberos cargados.</p>
          )}
          {barbers !== null && barbers.length > 0 && (
            <ul className="home__grid">
              {barbers.map((barber) => (
                <li key={barber.id} className="home__card home__card--barber">
                  <strong>{barber.name}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="home__section home__section--alt" aria-labelledby="home-hours-heading">
        <div className="container home__hours-block">
          <div>
            <h2 id="home-hours-heading">Horario</h2>
            <p className="home__hours">Lunes a sábado, de 09:00 a 20:00. Domingo cerrado.</p>
          </div>
          <div>
            <h2>Ubicación</h2>
            <p className="home__hours">Córdoba Capital, Argentina.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
