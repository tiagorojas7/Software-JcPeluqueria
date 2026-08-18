import { DEMO_BARBERS, DEMO_SERVICES } from '../shared/demo-data';
import { Link } from '../shared/router';
import './HomePage.css';

const STEPS = [
  { title: 'Elegí servicio y barbero', body: 'Corte, barba o los dos juntos, con el barbero que prefieras.' },
  { title: 'Elegí un horario libre', body: 'Vas a ver únicamente los horarios que están realmente disponibles.' },
  { title: 'Pagá la seña y listo', body: 'Una seña del 50% asegura tu lugar. El resto se paga en el local.' },
] as const;

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

      <section className="home__section home__section--alt" aria-labelledby="home-services-heading">
        <div className="container">
          <h2 id="home-services-heading">Servicios</h2>
          <ul className="home__grid">
            {DEMO_SERVICES.map((service) => (
              <li key={service.id} className="home__card">
                <strong>{service.name}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="home__section" aria-labelledby="home-team-heading">
        <div className="container">
          <h2 id="home-team-heading">Nuestro equipo</h2>
          <ul className="home__grid">
            {DEMO_BARBERS.map((barber) => (
              <li key={barber.id} className="home__card home__card--barber">
                <strong>{barber.name}</strong>
              </li>
            ))}
          </ul>
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
