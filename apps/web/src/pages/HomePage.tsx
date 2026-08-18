import { DEMO_BARBERS, DEMO_SERVICES } from '../shared/demo-data';
import { Link } from '../shared/router';
import './HomePage.css';

/**
 * D.2: the public landing page (`/`). Reuses the same demo reference data
 * `BookingPage` already draws from (`shared/demo-data.ts`) so the services
 * and team shown here are never out of sync with what a visitor can
 * actually book two clicks later.
 */
export function HomePage() {
  return (
    <div className="home">
      <section className="home__hero">
        <h1>JC Barbería</h1>
        <p>Cortes prolijos, sin vueltas. Reservá tu turno online en minutos y pagá la seña para asegurar tu lugar.</p>
        <Link to="/reservar" className="home__cta">
          Reservar turno
        </Link>
      </section>

      <section className="home__section" aria-labelledby="home-services-heading">
        <h2 id="home-services-heading">Servicios</h2>
        <ul className="home__grid">
          {DEMO_SERVICES.map((service) => (
            <li key={service.id} className="home__card">
              <strong>{service.name}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="home__section" aria-labelledby="home-team-heading">
        <h2 id="home-team-heading">Nuestro equipo</h2>
        <ul className="home__grid">
          {DEMO_BARBERS.map((barber) => (
            <li key={barber.id} className="home__card">
              <strong>{barber.name}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="home__section" aria-labelledby="home-hours-heading">
        <h2 id="home-hours-heading">Horario</h2>
        <p className="home__hours">Lunes a sábado, de 09:00 a 20:00. Domingo cerrado.</p>
      </section>
    </div>
  );
}
