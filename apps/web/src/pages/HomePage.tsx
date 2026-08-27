import { formatPriceArs } from '../shared/money';
import { Link } from '../shared/router';
import { useReferenceData } from '../shared/use-reference-data';
import './HomePage.css';

const STEPS = [
  { title: 'Elegí servicio y barbero', body: 'Corte, barba o los dos juntos, con el barbero que prefieras.' },
  { title: 'Elegí un horario libre', body: 'Vas a ver únicamente los horarios que están realmente disponibles.' },
  { title: 'Pagá la seña y listo', body: 'Una seña del 50% asegura tu lugar. El resto se paga en el local.' },
] as const;

/** What the shop wants a first-time visitor to know before scrolling. Copy,
 *  not data — none of it is in the database and none of it should be. */
const CLAIMS = [
  { title: 'Barberos expertos', body: 'Oficio y formación constante detrás de cada corte.' },
  { title: 'Reserva online 24/7', body: 'Sacá tu turno a cualquier hora, sin llamar.' },
  { title: 'Tu lugar asegurado', body: 'La seña del 50% deja el horario reservado a tu nombre.' },
  { title: 'Desde 1994', body: 'Tres décadas cortando en Córdoba Capital.' },
] as const;

/** Real photographs of the shop, served from `public/fotos/`. The place is
 *  dark, with wood and leather — that does not come across in text, and a
 *  stock image would be a lie about a business that exists. */
const GALLERY = [
  { src: '/fotos/salon.jpg', alt: 'Puestos de corte del salón, con los espejos iluminados', caption: 'El salón' },
  { src: '/fotos/espera.jpg', alt: 'Sala de espera con el logo JC pintado en la pared', caption: 'La espera' },
  { src: '/fotos/corte.jpg', alt: 'Un barbero de JC trabajando en un corte', caption: 'En el sillón' },
] as const;

/**
 * D.2 / datos-reales-en-ui: the public landing page (`/`). Fetches
 * `GET /barbers` (already active-only server-side, ListPublicBarbersUseCase)
 * and `GET /services` (real `priceCents`, formatted here via
 * `formatPriceArs`) on mount, so a deactivated barber or a changed price is
 * correct here the instant the panel changes it.
 *
 * The page used to be a stack of bare headings and one-line cards. It now
 * follows the shop's own identity: a photograph of the real storefront
 * behind the promise, services that state name/duration/price as three
 * separate things so two of them can be compared at a glance, the team, and
 * the place itself. Everything that is DATA still comes from the API —
 * nothing about the redesign hardcodes a service, a price or a barber.
 */
export function HomePage() {
  const { services, barbers, error } = useReferenceData();

  return (
    <div className="home">
      <section className="home__hero">
        {/* The hero photograph IS the largest contentful paint of the whole
            public site: eager and high-priority on purpose, unlike the
            gallery below it, which is lazy. Its box is reserved by CSS
            (`position: absolute; inset: 0`), so no width/height is needed
            to keep the layout stable. */}
        <img
          className="home__hero-photo"
          src="/fotos/fachada.jpg"
          alt="Frente de JC Barbería, en Córdoba Capital"
          fetchPriority="high"
          decoding="async"
        />
        <div className="home__hero-veil" />
        <div className="container home__hero-inner">
          <span className="home__eyebrow">JC Barbería · Córdoba Capital</span>
          <h1>
            Tu mejor versión,
            <br />
            todos los días.
          </h1>
          <p>Cortes prolijos, sin vueltas. Reservá tu turno online en minutos y pagá la seña para asegurar tu lugar.</p>
          <div className="home__hero-actions">
            <Link to="/reservar" className="home__cta">
              Reservar turno
            </Link>
            <a href="#servicios" className="home__cta home__cta--ghost">
              Ver servicios
            </a>
          </div>
        </div>
      </section>

      <section className="home__claims" aria-label="Por qué JC">
        <div className="container home__claims-grid">
          {CLAIMS.map((claim) => (
            <div key={claim.title} className="home__claim">
              <strong>{claim.title}</strong>
              <p>{claim.body}</p>
            </div>
          ))}
        </div>
      </section>

      {error && (
        <div className="container">
          <p role="alert">{error}</p>
        </div>
      )}

      <section className="home__section" id="servicios" aria-labelledby="home-services-heading">
        <div className="container">
          <span className="home__eyebrow">Catálogo</span>
          <h2 id="home-services-heading">Servicios</h2>
          <p className="home__section-note">Todos los barberos hacen todos los servicios.</p>

          {services === null && !error && <p className="empty-state">Cargando servicios...</p>}
          {services !== null && services.length === 0 && (
            <p className="empty-state">Todavía no hay servicios cargados.</p>
          )}
          {services !== null && services.length > 0 && (
            <ul className="home__services">
              {services.map((service) => (
                <li key={service.id} className="home__service">
                  <span className="home__service-name">{service.name}</span>
                  <span className="home__service-duration">{service.durationMinutes} min</span>
                  <span className="home__service-price">{formatPriceArs(service.priceCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="home__section home__section--alt" aria-labelledby="home-steps-heading">
        <div className="container">
          <span className="home__eyebrow">Reservá en 3 pasos</span>
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

      <section className="home__section" aria-labelledby="home-team-heading">
        <div className="container">
          <span className="home__eyebrow">El equipo</span>
          <h2 id="home-team-heading">Nuestros barberos</h2>

          {barbers === null && !error && <p className="empty-state">Cargando equipo...</p>}
          {barbers !== null && barbers.length === 0 && (
            <p className="empty-state">Todavía no hay barberos cargados.</p>
          )}
          {barbers !== null && barbers.length > 0 && (
            <ul className="home__team">
              {barbers.map((barber) => (
                <li key={barber.id} className="home__barber">
                  {/* Placeholder silhouette, not a stock portrait: putting a
                      stranger's face under a real barber's name would be a
                      lie about who works here. */}
                  <span className="home__barber-avatar" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" />
                      <path d="M3.5 22a8.5 8.5 0 0 1 17 0z" />
                    </svg>
                  </span>
                  <strong>{barber.name}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="home__section home__section--alt" aria-labelledby="home-place-heading">
        <div className="container">
          <span className="home__eyebrow">El lugar</span>
          <h2 id="home-place-heading">Así se vive JC</h2>
          <ul className="home__gallery">
            {GALLERY.map((photo) => (
              <li key={photo.src} className="home__gallery-item">
                <img src={photo.src} alt={photo.alt} loading="lazy" />
                <span className="home__gallery-caption">{photo.caption}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="home__section" aria-labelledby="home-hours-heading">
        <div className="container home__hours-block">
          <div>
            <span className="home__eyebrow">Visitanos</span>
            <h2 id="home-hours-heading">Horario</h2>
            <p className="home__hours">Lunes a sábado, de 09:00 a 20:00. Domingo cerrado.</p>
          </div>
          <div>
            <h2>Ubicación</h2>
            <p className="home__hours">Córdoba Capital, Argentina.</p>
          </div>
        </div>
      </section>

      <section className="home__closer">
        <div className="container home__closer-inner">
          <h2>¿Listo para tu próximo corte?</h2>
          <p>Elegí barbero, servicio y horario. Te lleva dos minutos.</p>
          <Link to="/reservar" className="home__cta">
            Reservar turno
          </Link>
        </div>
      </section>
    </div>
  );
}
