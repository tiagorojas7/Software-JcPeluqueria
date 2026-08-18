import { useState, type FormEvent } from 'react';
import type { ClientRecordResponse } from '@jc-barberia/contracts';

import { apiGet, apiPost, apiPut, describeError } from '../shared/api-client';
import { DEMO_BARBERS, DEMO_SERVICES } from '../shared/demo-data';
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
 * There is no `GET /panel/barbers` (list) endpoint, so — same choice
 * `BookingPage` already made for the same reason — barber/service pickers
 * below reuse `DEMO_BARBERS`/`DEMO_SERVICES` instead of fetching a list.
 * Adding a new barber here does not retroactively appear in that fixed
 * list; a fresh page load already would not know about it either, since
 * there is nothing to list it from.
 */
export function ManagementPage({ actor }: ManagementPageProps) {
  return (
    <section>
      <h2>Gestión</h2>
      {hasPermission(actor.role, 'client:manage') && <ClientsSection />}
      {hasPermission(actor.role, 'barber:manage') && <BarbersSection />}
      {hasPermission(actor.role, 'schedule:configure') && <SchedulesSection />}
      {hasPermission(actor.role, 'pricing:configure') && <PricingSection />}
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
      {clients && (
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

function BarbersSection() {
  const [name, setName] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [opensAt, setOpensAt] = useState('09:00');
  const [closesAt, setClosesAt] = useState('18:00');
  const [barberToDeactivate, setBarberToDeactivate] = useState(DEMO_BARBERS[0].id);
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
      setNotice(`${created.name} dado de alta correctamente.`);
      setName('');
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleDeactivate() {
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
            {DEMO_BARBERS.map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.name}
              </option>
            ))}
          </select>
        </span>
        <button type="submit">Dar de baja</button>
      </form>
    </div>
  );
}

function SchedulesSection() {
  const [barberId, setBarberId] = useState(DEMO_BARBERS[0].id);
  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [opensAt, setOpensAt] = useState('09:00');
  const [closesAt, setClosesAt] = useState('18:00');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
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

  return (
    <div className="management__section">
      <h3>Horarios</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form className="management__form" onSubmit={handleSubmit}>
        <span className="management__field">
          <label htmlFor="mgmt-schedule-barber">Barbero</label>
          <select id="mgmt-schedule-barber" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
            {DEMO_BARBERS.map((barber) => (
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

function PricingSection() {
  const [serviceId, setServiceId] = useState(DEMO_SERVICES[0].id);
  const [priceArs, setPriceArs] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/panel/services/${serviceId}/price`, { priceCents: Math.round(Number(priceArs) * 100) });
      setNotice('Precio actualizado correctamente.');
    } catch (err) {
      setError(describeError(err));
    }
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
            {DEMO_SERVICES.map((service) => (
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
