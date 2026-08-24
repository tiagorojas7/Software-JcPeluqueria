import { useEffect, useState, type FormEvent } from 'react';
import type {
  ClientRecordResponse,
  PublicBarberResponse,
  PublicBarbersResponse,
  PublicServiceResponse,
  PublicServicesResponse,
} from '@jc-barberia/contracts';

import { apiGet, apiPost, apiPut, describeError } from '../shared/api-client';
import { hasPermission } from '../shared/permissions';
import type { Actor } from '../shared/actor';
import './ManagementPage.css';

export interface ManagementPageProps {
  readonly actor: Actor;
}

/**
 * D.3/D.6: `client:manage`/`barber:manage`/`schedule:configure`/
 * `pricing:configure` (`ManageClientsAndBarbersController`) had real,
 * tested backend routes and NO screen at all — reachable only by curl,
 * which tasks.md's own acceptance bar says does not count as done. Built
 * for real here, one section per permission, each section gated by
 * `hasPermission` — the same source of truth `PanelLayout`'s nav already
 * uses, never a second hardcoded role check.
 *
 * datos-reales-en-ui: used to feed the barber/service pickers below from
 * `shared/demo-data.ts`. Now fetches `GET /barbers` (active-only — exactly
 * the set a barber CAN still be deactivated/rescheduled from;
 * `ManageClientsAndBarbersUseCase` has no "reactivate" operation, so an
 * already-deactivated barber has nothing to be picked for here) and
 * `GET /services` once, up front, only when the actor's role actually needs
 * one of the sections that uses them.
 */
export function ManagementPage({ actor }: ManagementPageProps) {
  const canClients = hasPermission(actor.role, 'client:manage');
  const canBarbers = hasPermission(actor.role, 'barber:manage');
  const canSchedules = hasPermission(actor.role, 'schedule:configure');
  const canPricing = hasPermission(actor.role, 'pricing:configure');
  const hasAnySection = canClients || canBarbers || canSchedules || canPricing;
  const needsReferenceData = canBarbers || canSchedules || canPricing;

  const [barbers, setBarbers] = useState<readonly PublicBarberResponse[] | null>(null);
  const [services, setServices] = useState<readonly PublicServiceResponse[] | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);

  useEffect(() => {
    if (!needsReferenceData) {
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const [barbersResponse, servicesResponse] = await Promise.all([
          apiGet<PublicBarbersResponse>('/barbers'),
          apiGet<PublicServicesResponse>('/services'),
        ]);
        if (cancelled) {
          return;
        }
        setBarbers(barbersResponse.barbers);
        setServices(servicesResponse.services);
      } catch (err) {
        if (!cancelled) {
          setReferenceError(describeError(err));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [needsReferenceData]);

  const referenceDataReady = barbers !== null && services !== null && !referenceError;

  return (
    <section className="management">
      <h2>Gestión</h2>
      {!hasAnySection && <p className="empty-state">Tu cuenta no tiene acceso a ninguna sección de gestión.</p>}
      {referenceError && <p role="alert">{referenceError}</p>}
      {canClients && <ClientsSection />}
      {needsReferenceData && !referenceDataReady && !referenceError && (
        <p className="empty-state">Cargando barberos y servicios...</p>
      )}
      {canBarbers && referenceDataReady && <BarbersSection barbers={barbers} />}
      {canSchedules && referenceDataReady && <SchedulesSection barbers={barbers} />}
      {canPricing && referenceDataReady && <PricingSection services={services} />}
    </section>
  );
}

function ClientsSection() {
  const [clients, setClients] = useState<readonly ClientRecordResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad() {
    setError(null);
    try {
      const response = await apiGet<{ clients: readonly ClientRecordResponse[] }>('/panel/clients');
      setClients(response.clients);
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="management__section">
      <h3>Clientes</h3>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={handleLoad}>
        Cargar clientes
      </button>
      {clients && clients.length === 0 && <p className="empty-state">Todavía no hay clientes cargados.</p>}
      {clients && clients.length > 0 && (
        <table className="management__table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Email</th>
              <th>Edad</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id}>
                <td>{client.name}</td>
                <td>{client.phone}</td>
                <td>{client.email ?? '—'}</td>
                <td>{client.age ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface BarbersSectionProps {
  readonly barbers: readonly PublicBarberResponse[];
}

function BarbersSection({ barbers }: BarbersSectionProps) {
  const [firstBarber] = barbers;
  const [name, setName] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [opensAt, setOpensAt] = useState('09:00');
  const [closesAt, setClosesAt] = useState('18:00');
  const [barberToDeactivate, setBarberToDeactivate] = useState<string>(firstBarber?.id ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAddBarber(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await apiPost<{ id: string; name: string; active: boolean }>('/panel/barbers', {
        name,
        schedule: [{ dayOfWeek: Number(dayOfWeek), opensAt, closesAt }],
      });
      setNotice(`${created.name} dado de alta correctamente. Recargá la página para verlo en los selectores.`);
      setName('');
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleDeactivate() {
    if (!barberToDeactivate) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await apiPost(`/panel/barbers/${barberToDeactivate}/deactivate`);
      setNotice('Barbero dado de baja correctamente.');
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="management__section">
      <h3>Barberos</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <form className="management__form" onSubmit={handleAddBarber}>
        <span className="management__field">
          <label htmlFor="mgmt-barber-name">Nombre del barbero</label>
          <input id="mgmt-barber-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </span>
        <span className="management__field">
          <label htmlFor="mgmt-barber-day">Día (alta)</label>
          <select id="mgmt-barber-day" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
            {DAY_OF_WEEK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
        <span className="management__field">
          <label htmlFor="mgmt-barber-opens">Abre (alta)</label>
          <input
            id="mgmt-barber-opens"
            type="time"
            required
            value={opensAt}
            onChange={(e) => setOpensAt(e.target.value)}
          />
        </span>
        <span className="management__field">
          <label htmlFor="mgmt-barber-closes">Cierra (alta)</label>
          <input
            id="mgmt-barber-closes"
            type="time"
            required
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
          />
        </span>
        <button type="submit">Dar de alta</button>
      </form>

      {barbers.length === 0 ? (
        <p className="empty-state">Todavía no hay barberos activos para dar de baja.</p>
      ) : (
        <form
          className="management__form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleDeactivate();
          }}
        >
          <span className="management__field">
            <label htmlFor="mgmt-barber-deactivate">Barbero a dar de baja</label>
            <select
              id="mgmt-barber-deactivate"
              value={barberToDeactivate}
              onChange={(e) => setBarberToDeactivate(e.target.value)}
            >
              {barbers.map((barber) => (
                <option key={barber.id} value={barber.id}>
                  {barber.name}
                </option>
              ))}
            </select>
          </span>
          <button type="submit">Dar de baja</button>
        </form>
      )}
    </div>
  );
}

interface SchedulesSectionProps {
  readonly barbers: readonly PublicBarberResponse[];
}

function SchedulesSection({ barbers }: SchedulesSectionProps) {
  const [firstBarber] = barbers;
  const [barberId, setBarberId] = useState<string>(firstBarber?.id ?? '');
  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [opensAt, setOpensAt] = useState('09:00');
  const [closesAt, setClosesAt] = useState('18:00');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!barberId) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/panel/barbers/${barberId}/schedule`, {
        dayOfWeek: Number(dayOfWeek),
        opensAt,
        closesAt,
      });
      setNotice('Horario actualizado correctamente.');
    } catch (err) {
      setError(describeError(err));
    }
  }

  if (barbers.length === 0) {
    return (
      <div className="management__section">
        <h3>Horarios</h3>
        <p className="empty-state">Todavía no hay barberos activos para configurar.</p>
      </div>
    );
  }

  return (
    <div className="management__section">
      <h3>Horarios</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form className="management__form" onSubmit={handleSubmit}>
        <span className="management__field">
          <label htmlFor="mgmt-schedule-barber">Barbero</label>
          <select id="mgmt-schedule-barber" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
            {barbers.map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.name}
              </option>
            ))}
          </select>
        </span>
        <span className="management__field">
          <label htmlFor="mgmt-schedule-day">Día (horario)</label>
          <select id="mgmt-schedule-day" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
            {DAY_OF_WEEK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
        <span className="management__field">
          <label htmlFor="mgmt-schedule-opens">Abre (horario)</label>
          <input
            id="mgmt-schedule-opens"
            type="time"
            required
            value={opensAt}
            onChange={(e) => setOpensAt(e.target.value)}
          />
        </span>
        <span className="management__field">
          <label htmlFor="mgmt-schedule-closes">Cierra (horario)</label>
          <input
            id="mgmt-schedule-closes"
            type="time"
            required
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
          />
        </span>
        <button type="submit">Guardar horario</button>
      </form>
    </div>
  );
}

interface PricingSectionProps {
  readonly services: readonly PublicServiceResponse[];
}

function PricingSection({ services }: PricingSectionProps) {
  const [firstService] = services;
  const [serviceId, setServiceId] = useState<string>(firstService?.id ?? '');
  const [priceArs, setPriceArs] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!serviceId) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/panel/services/${serviceId}/price`, { priceCents: Math.round(Number(priceArs) * 100) });
      setNotice('Precio actualizado correctamente.');
    } catch (err) {
      setError(describeError(err));
    }
  }

  if (services.length === 0) {
    return (
      <div className="management__section">
        <h3>Precios</h3>
        <p className="empty-state">Todavía no hay servicios cargados.</p>
      </div>
    );
  }

  return (
    <div className="management__section">
      <h3>Precios</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form className="management__form" onSubmit={handleSubmit}>
        <span className="management__field">
          <label htmlFor="mgmt-pricing-service">Servicio</label>
          <select id="mgmt-pricing-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </span>
        <span className="management__field">
          <label htmlFor="mgmt-pricing-price">Precio (ARS)</label>
          <input
            id="mgmt-pricing-price"
            type="number"
            min="1"
            required
            value={priceArs}
            onChange={(e) => setPriceArs(e.target.value)}
          />
        </span>
        <button type="submit">Actualizar precio</button>
      </form>
    </div>
  );
}

const DAY_OF_WEEK_OPTIONS = [
  { value: '0', label: 'Domingo' },
  { value: '1', label: 'Lunes' },
  { value: '2', label: 'Martes' },
  { value: '3', label: 'Miércoles' },
  { value: '4', label: 'Jueves' },
  { value: '5', label: 'Viernes' },
  { value: '6', label: 'Sábado' },
] as const;
