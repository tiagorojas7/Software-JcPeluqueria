import { useEffect, useState, type FormEvent } from 'react';
import type {
  BarberAccountResponse,
  BarberAccountsListResponse,
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
      {/* Its own fetch, independent of the barber/service reference data —
          an account exists whether or not the barber is still active, so this
          section must not disappear behind that gate. */}
      {canBarbers && <BarberAccountsSection />}
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

/** ISO-8601-ish weekday order this codebase already uses everywhere else
 *  (`DAY_OF_WEEK_OPTIONS` below, `BarberScheduleDaySchema`): 0=domingo. */
interface WeekDayEntry {
  readonly dayOfWeek: number;
  readonly label: string;
  readonly enabled: boolean;
  readonly opensAt: string;
  readonly closesAt: string;
}

function buildDefaultWeek(): WeekDayEntry[] {
  return DAY_OF_WEEK_OPTIONS.map((option) => ({
    dayOfWeek: Number(option.value),
    label: option.label,
    enabled: false,
    opensAt: '09:00',
    closesAt: '18:00',
  }));
}

/** Only the checked days become rows — matches
 *  `ConfigureBarberWeekRequestSchema`/`AddBarberRequestSchema.schedule`
 *  exactly. */
function weekToScheduleDays(week: readonly WeekDayEntry[]) {
  return week
    .filter((day) => day.enabled)
    .map((day) => ({ dayOfWeek: day.dayOfWeek, opensAt: day.opensAt, closesAt: day.closesAt }));
}

interface WeekScheduleFieldsProps {
  readonly idPrefix: string;
  readonly week: readonly WeekDayEntry[];
  readonly onChange: (week: readonly WeekDayEntry[]) => void;
}

/**
 * panel-usable: shared by `BarbersSection` (alta) and `SchedulesSection`
 * (edición) so BOTH send the barber's whole week in one request instead of
 * one day at a time — verified against the database: seeded barbers have
 * 4-5 `barber_schedules` rows, every barber created or scheduled through the
 * panel had exactly 1, because the panel only ever offered one day-of-week
 * selector per call. One checkbox + horario per day of the week; only the
 * checked days are sent.
 */
function WeekScheduleFields({ idPrefix, week, onChange }: WeekScheduleFieldsProps) {
  function updateDay(index: number, patch: Partial<WeekDayEntry>) {
    onChange(week.map((day, i) => (i === index ? { ...day, ...patch } : day)));
  }

  return (
    <fieldset className="management__week">
      <legend>Días de trabajo</legend>
      {week.map((day, index) => (
        <div className="management__week-day" key={day.dayOfWeek}>
          <label htmlFor={`${idPrefix}-${day.dayOfWeek}-enabled`}>
            <input
              id={`${idPrefix}-${day.dayOfWeek}-enabled`}
              type="checkbox"
              checked={day.enabled}
              onChange={(e) => updateDay(index, { enabled: e.target.checked })}
            />
            {day.label}
          </label>
          <label htmlFor={`${idPrefix}-${day.dayOfWeek}-opens`}>Abre</label>
          <input
            id={`${idPrefix}-${day.dayOfWeek}-opens`}
            type="time"
            disabled={!day.enabled}
            value={day.opensAt}
            onChange={(e) => updateDay(index, { opensAt: e.target.value })}
          />
          <label htmlFor={`${idPrefix}-${day.dayOfWeek}-closes`}>Cierra</label>
          <input
            id={`${idPrefix}-${day.dayOfWeek}-closes`}
            type="time"
            disabled={!day.enabled}
            value={day.closesAt}
            onChange={(e) => updateDay(index, { closesAt: e.target.value })}
          />
        </div>
      ))}
    </fieldset>
  );
}

interface BarbersSectionProps {
  readonly barbers: readonly PublicBarberResponse[];
}

function BarbersSection({ barbers }: BarbersSectionProps) {
  const [firstBarber] = barbers;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [week, setWeek] = useState<readonly WeekDayEntry[]>(buildDefaultWeek);
  const [barberToDeactivate, setBarberToDeactivate] = useState<string>(firstBarber?.id ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAddBarber(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const schedule = weekToScheduleDays(week);
    if (schedule.length === 0) {
      setError('Elegí al menos un día de trabajo.');
      return;
    }
    try {
      const created = await apiPost<{ id: string; name: string; active: boolean }>('/panel/barbers', {
        name,
        email,
        schedule,
      });
      setNotice(
        `${created.name} dado de alta correctamente. Le enviamos a ${email} un enlace para que active su cuenta y elija su contraseña. Recargá la página para verlo en los selectores.`,
      );
      setName('');
      setEmail('');
      setWeek(buildDefaultWeek());
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
          <label htmlFor="mgmt-barber-email">Email del barbero</label>
          <input
            id="mgmt-barber-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <small>Le llega ahí el enlace para activar su cuenta. Es también el usuario con el que va a entrar.</small>
        </span>
        <WeekScheduleFields idPrefix="mgmt-barber-week" week={week} onChange={setWeek} />
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

/**
 * panel-usable: used to PUT one day at a time to `/panel/barbers/:id/schedule`
 * — configuring a five-day week took five separate submits, and the panel
 * only ever made one, which is exactly why a newly created or rescheduled
 * barber ended up with a single `barber_schedules` row (the owner's own
 * words: "al dar de alta un barbero, aparece, pero no se están cargando
 * correctamente los horarios"). Now PUTs the whole checked week in one
 * request to `/panel/barbers/:id/schedule/week` — same `WeekScheduleFields`
 * `BarbersSection` uses for alta, so both screens configure a week the same
 * way.
 */
function SchedulesSection({ barbers }: SchedulesSectionProps) {
  const [firstBarber] = barbers;
  const [barberId, setBarberId] = useState<string>(firstBarber?.id ?? '');
  const [week, setWeek] = useState<readonly WeekDayEntry[]>(buildDefaultWeek);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!barberId) {
      return;
    }
    const schedule = weekToScheduleDays(week);
    if (schedule.length === 0) {
      setError('Elegí al menos un día de trabajo.');
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/panel/barbers/${barberId}/schedule/week`, { schedule });
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
        <WeekScheduleFields idPrefix="mgmt-schedule-week" week={week} onChange={setWeek} />
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

/**
 * "la cuenta de cada barbero y tener todo el control sobre las cuentas para
 * que ingresen" — the owner's view of who can actually get into the panel.
 * Gated by `barber:manage`, which the 3b seed grants to the owner ALONE, so
 * the secretary never sees this section even though she manages clients and
 * turnos all day.
 *
 * What the owner controls here is the ACCOUNT, not the credential. There is
 * no password field on this screen, in either direction: no place to type
 * one, and nothing that could display one. The two real actions are
 * re-sending the activation link (which doubles as the password reset — same
 * write, see `ManageBarberAccountsUseCase.resendInvite`) and switching access
 * on and off.
 *
 * "Sin activar" is the state worth surfacing: an account invited and never
 * used is the one that needs chasing, and it is invisible from every other
 * screen — the barber shows up in the agenda and in availability regardless.
 */
function BarberAccountsSection() {
  const [accounts, setAccounts] = useState<readonly BarberAccountResponse[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Email being typed for a barber who has no account yet, keyed by barber. */
  const [pendingEmails, setPendingEmails] = useState<Record<string, string>>({});

  async function load() {
    try {
      const response = await apiGet<BarberAccountsListResponse>('/panel/barber-accounts');
      setAccounts(response.accounts);
    } catch (err) {
      setError(describeError(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleResend(account: BarberAccountResponse) {
    setError(null);
    setNotice(null);
    try {
      await apiPost(`/panel/barber-accounts/${account.userId}/resend-invite`);
      setNotice(
        account.activated
          ? `Le mandamos a ${account.email} un enlace para elegir una contraseña nueva. La anterior deja de servir.`
          : `Reenviamos la invitación a ${account.email}. El enlace anterior deja de servir.`,
      );
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleInvite(account: BarberAccountResponse) {
    const email = (pendingEmails[account.barberId] ?? '').trim();
    if (!email) {
      setError(`Escribí el email de ${account.barberName} para poder invitarlo.`);
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await apiPost('/panel/barber-accounts', { barberId: account.barberId, email });
      setNotice(`Le mandamos a ${email} un enlace para que ${account.barberName} elija su contraseña.`);
      setPendingEmails((current) => ({ ...current, [account.barberId]: '' }));
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleToggleActive(account: BarberAccountResponse) {
    setError(null);
    setNotice(null);
    try {
      await apiPost(`/panel/barber-accounts/${account.userId}/active`, { active: !account.active });
      setNotice(
        account.active
          ? `${account.barberName} ya no puede entrar al panel. Sus turnos no cambian.`
          : `${account.barberName} puede volver a entrar al panel.`,
      );
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="management__section">
      <h3>Cuentas de barberos</h3>
      <p className="management__hint">
        Cada barbero elige su propia contraseña desde el enlace que le mandamos. Vos manejás la cuenta: podés reenviar
        el enlace, resetear la contraseña y quitar o devolver el acceso — nunca ves ni escribís la contraseña de nadie.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {accounts === null && !error && <p className="empty-state">Cargando cuentas...</p>}
      {accounts !== null && accounts.length === 0 && <p className="empty-state">Todavía no hay barberos.</p>}
      {accounts !== null && accounts.length > 0 && (
        <table className="management__table">
          <thead>
            <tr>
              <th scope="col">Barbero</th>
              <th scope="col">Email</th>
              <th scope="col">Estado</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.barberId}>
                <td>{account.barberName}</td>
                <td>
                  {account.userId === null ? (
                    <input
                      aria-label={`Email de ${account.barberName}`}
                      type="email"
                      placeholder="email@ejemplo.com"
                      value={pendingEmails[account.barberId] ?? ''}
                      onChange={(e) =>
                        setPendingEmails((current) => ({ ...current, [account.barberId]: e.target.value }))
                      }
                    />
                  ) : (
                    account.email
                  )}
                </td>
                <td>
                  {account.userId === null
                    ? 'Sin cuenta — no puede entrar'
                    : !account.active
                      ? 'Acceso quitado'
                      : account.activated
                        ? 'Activa'
                        : 'Sin activar — todavía no entró'}
                </td>
                <td>
                  {account.userId === null ? (
                    <button type="button" onClick={() => void handleInvite(account)}>
                      Crear cuenta e invitar
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => void handleResend(account)}>
                        {account.activated ? 'Resetear contraseña' : 'Reenviar invitación'}
                      </button>
                      <button type="button" onClick={() => void handleToggleActive(account)}>
                        {account.active ? 'Quitar acceso' : 'Devolver acceso'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
