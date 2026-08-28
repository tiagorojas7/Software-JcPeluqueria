import { useEffect, useState, type FormEvent } from 'react';
import type {
  BarberAccountResponse,
  BarberAccountsListResponse,
  BarberManagementResponse,
  BarbersManagementListResponse,
  BarberWeekResponse,
  ClientRecordResponse,
  ConfigureBarberWeekResponseBody,
  PublicBarberResponse,
  PublicServiceResponse,
} from '@jc-barberia/contracts';

import { apiDelete, apiGet, apiPost, apiPut, describeError } from '../shared/api-client';
import { formatPriceArs, parsePriceArsInput } from '../shared/money';
import { hasPermission } from '../shared/permissions';
import { useReferenceData } from '../shared/use-reference-data';
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
 * datos-reales-en-ui: used to feed the schedule/service pickers below from
 * `shared/demo-data.ts`. Now fetches `GET /barbers` (active-only — exactly
 * the set "Horarios" can configure; a barber on baja, temporal or
 * definitiva, has nothing to schedule until reactivated) and `GET /services`
 * once, up front, only when the actor's role actually needs one of the
 * sections that uses them. `BarbersSection` (migration 0013) needs BOTH
 * active and inactive barbers — active-only would hide the very rows the
 * owner needs to reactivate — so it fetches `GET /panel/barbers` on its own
 * instead of sharing this hook.
 */
export function ManagementPage({ actor }: ManagementPageProps) {
  const canClients = hasPermission(actor.role, 'client:manage');
  const canBarbers = hasPermission(actor.role, 'barber:manage');
  const canSchedules = hasPermission(actor.role, 'schedule:configure');
  const canPricing = hasPermission(actor.role, 'pricing:configure');
  const hasAnySection = canClients || canBarbers || canSchedules || canPricing;
  const needsReferenceData = canSchedules || canPricing;

  const {
    barbers,
    services,
    error: referenceError,
    ready: referenceDataReady,
  } = useReferenceData({ enabled: needsReferenceData });

  return (
    <section className="management">
      <h2>Gestión</h2>
      {!hasAnySection && <p className="empty-state">Tu cuenta no tiene acceso a ninguna sección de gestión.</p>}
      {referenceError && <p role="alert">{referenceError}</p>}
      {canClients && <ClientsSection />}
      {needsReferenceData && !referenceDataReady && !referenceError && (
        <p className="empty-state">Cargando barberos y servicios...</p>
      )}
      {/* Its own fetch, independent of the reference data above — needs
          INACTIVE barbers too, which `useReferenceData`'s `GET /barbers`
          deliberately never returns. */}
      {canBarbers && <BarbersSection />}
      {/* Also its own fetch, independent of the barber/service reference
          data — an account exists whether or not the barber is still
          active, so this section must not disappear behind that gate. */}
      {canBarbers && <BarberAccountsSection />}
      {/* `barbers &&`/`services &&` rather than `referenceDataReady`: the
          flag says the same thing, but only the direct checks narrow the
          nullable lists for the props below. */}
      {canSchedules && barbers && <SchedulesSection barbers={barbers} />}
      {canPricing && services && <PricingSection services={services} />}
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

/**
 * Migration 0013's three states, derived from `active`/`permanentLeave`
 * rather than sent as an enum — same shape as `accountState` below, and for
 * the same reason: the id travels to the DOM as `data-state` so the state is
 * assertable and scannable, never carried by colour alone.
 */
function barberState(barber: {
  readonly active: boolean;
  readonly permanentLeave: boolean;
}): { readonly id: string; readonly label: string } {
  if (barber.active) {
    return { id: 'activo', label: 'Activo' };
  }
  if (barber.permanentLeave) {
    return { id: 'baja-definitiva', label: 'Baja definitiva' };
  }
  return { id: 'baja-temporal', label: 'De baja temporal' };
}

/**
 * Migration 0013 — the owner's own two reports: no way back from a baja
 * (a barber out sick for a day had to be deactivated, then the whole week
 * reconfigured to bring them back), and no way to remove a barber who never
 * worked (typo'd email, never activated, six of them cluttering the shop's
 * real database). Replaces the old "Barbero a dar de baja" `<select>` — fed
 * by the ACTIVE-only public barbers, so an already-deactivated barber had
 * literally no control that could reach them again — with a table of EVERY
 * barber and the actions their own state allows:
 *
 *   Activo          → Dar de baja temporal · Baja definitiva
 *   De baja temporal → Reactivar · Baja definitiva · Eliminar (sin turnos)
 *   Baja definitiva  → Reactivar · Eliminar (sin turnos)
 *
 * "Dar de baja temporal"/"Reactivar" need no confirmation — both are one
 * click away from each other, nothing is lost either way. "Baja definitiva"
 * and "Eliminar" DO, following the exact two-step pattern
 * `BarberAccountsSection`'s "Eliminar cuenta" already established: a click
 * shows what happens in plain words, a second click is the only thing that
 * actually writes.
 */
function BarbersSection() {
  const [barbers, setBarbers] = useState<readonly BarberManagementResponse[] | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [week, setWeek] = useState<readonly WeekDayEntry[]>(buildDefaultWeek);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The barber, and WHICH destructive action, awaiting confirmation — a
   *  barber can only ever have one confirmation open at a time, but the two
   *  destructive actions ("terminate" = baja definitiva, "delete" = eliminar)
   *  say different things, so the action is part of the key. */
  const [confirming, setConfirming] = useState<{ barberId: string; action: 'terminate' | 'delete' } | null>(null);

  async function load() {
    try {
      const response = await apiGet<BarbersManagementListResponse>('/panel/barbers');
      setBarbers(response.barbers);
    } catch (err) {
      setError(describeError(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

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
        `${created.name} dado de alta correctamente. Le enviamos a ${email} un enlace para que active su cuenta y elija su contraseña.`,
      );
      setName('');
      setEmail('');
      setWeek(buildDefaultWeek());
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleDeactivate(barber: BarberManagementResponse) {
    setError(null);
    setNotice(null);
    try {
      await apiPost(`/panel/barbers/${barber.id}/deactivate`);
      setNotice(`${barber.name} queda de baja temporal. Su horario se conserva — un click y vuelve a estar activo.`);
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  }

  /**
   * The two bajas come back differently, and only one of them comes back
   * whole. A baja temporal never lost anything: the schedule and the staff
   * account both survived, so reactivating really is the single click the
   * deactivation notice promised. A baja definitiva DID lose the account —
   * `terminate` deletes it, by design — so the barber returns to the agenda
   * bookable but unable to log in, and the owner has to invite them again
   * from "Cuentas de barberos" right below.
   *
   * Saying "vuelve a estar activo, con el mismo horario de antes" for both
   * would be true about the horario and quietly false about the account,
   * which is the exact shape of bug this panel keeps producing: a screen
   * that reports the write it made instead of the state the shop is now in.
   */
  async function handleReactivate(barber: BarberManagementResponse) {
    setError(null);
    setNotice(null);
    // Read BEFORE the write: `load()` below replaces this row with its new
    // state, where `permanentLeave` is already false for both cases.
    const wasTerminated = barber.permanentLeave;
    try {
      await apiPost(`/panel/barbers/${barber.id}/reactivate`);
      setNotice(
        wasTerminated
          ? `${barber.name} vuelve a estar activo, con el mismo horario de antes. Su cuenta del panel se había eliminado con la baja definitiva: para que pueda volver a entrar, invitalo de nuevo desde "Cuentas de barberos".`
          : `${barber.name} vuelve a estar activo, con el mismo horario y la misma cuenta de antes.`,
      );
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleTerminate(barber: BarberManagementResponse) {
    setError(null);
    setNotice(null);
    try {
      await apiPost(`/panel/barbers/${barber.id}/terminate`);
      setConfirming(null);
      setNotice(`${barber.name} queda de baja definitiva. Sus turnos siguen en el historial del local; su cuenta del panel fue eliminada.`);
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleDelete(barber: BarberManagementResponse) {
    setError(null);
    setNotice(null);
    try {
      await apiDelete(`/panel/barbers/${barber.id}`);
      setConfirming(null);
      setNotice(`${barber.name} fue eliminado del sistema.`);
      await load();
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

      {barbers === null && !error && <p className="empty-state">Cargando barberos...</p>}
      {barbers !== null && barbers.length === 0 && <p className="empty-state">Todavía no hay barberos.</p>}
      {barbers !== null && barbers.length > 0 && (
        <table className="management__table">
          <thead>
            <tr>
              <th scope="col">Barbero</th>
              <th scope="col">Estado</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {barbers.map((barber) => {
              const state = barberState(barber);
              return (
                <tr key={barber.id}>
                  <td>{barber.name}</td>
                  <td>
                    <span className="management__state" data-state={state.id}>
                      {state.label}
                    </span>
                  </td>
                  <td>
                    {barber.active && (
                      <button type="button" onClick={() => void handleDeactivate(barber)}>
                        Dar de baja temporal
                      </button>
                    )}
                    {!barber.active && (
                      <button type="button" onClick={() => void handleReactivate(barber)}>
                        Reactivar
                      </button>
                    )}
                    {!barber.permanentLeave && (
                      <button
                        type="button"
                        className="management__danger"
                        onClick={() => setConfirming({ barberId: barber.id, action: 'terminate' })}
                      >
                        Baja definitiva
                      </button>
                    )}
                    {/* Only ever offered once a barber is OFF the agenda —
                        "Activo" never shows it, matching the action table:
                        deleting someone still active would be a baja
                        wearing the wrong name. */}
                    {!barber.active && barber.canDelete && (
                      <button
                        type="button"
                        className="management__danger"
                        onClick={() => setConfirming({ barberId: barber.id, action: 'delete' })}
                      >
                        Eliminar
                      </button>
                    )}
                    {confirming?.barberId === barber.id && confirming.action === 'terminate' && (
                      <p className="management__confirm" role="status">
                        ¿Dar de baja definitiva a {barber.name}? Sus turnos quedan en el historial del local, pero su
                        cuenta del panel se elimina — no vas a poder deshacerlo.{' '}
                        <button type="button" className="management__danger" onClick={() => void handleTerminate(barber)}>
                          Sí, baja definitiva
                        </button>{' '}
                        <button type="button" onClick={() => setConfirming(null)}>
                          Cancelar
                        </button>
                      </p>
                    )}
                    {confirming?.barberId === barber.id && confirming.action === 'delete' && (
                      <p className="management__confirm" role="status">
                        ¿Eliminar a {barber.name}? Desaparece por completo del sistema — esto solo es posible porque
                        nunca tuvo un turno. No vas a poder deshacerlo.{' '}
                        <button type="button" className="management__danger" onClick={() => void handleDelete(barber)}>
                          Sí, eliminar
                        </button>{' '}
                        <button type="button" onClick={() => setConfirming(null)}>
                          Cancelar
                        </button>
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
 *
 * docs/HUECOS-BACKEND.md #6, segunda parte: turning a day off can orphan an
 * already-`reservado` turno still sitting on it. The endpoint answers
 * `{ configured: false, affectedAppointmentIds }` WITHOUT writing anything
 * in that case, and this screen has to actually stop and ask — showing the
 * "Horario actualizado" notice regardless of the response body would be the
 * exact lie #6 was about, just moved one layer up: the owner would see
 * success while nothing was saved.
 */
function SchedulesSection({ barbers }: SchedulesSectionProps) {
  const [firstBarber] = barbers;
  const [barberId, setBarberId] = useState<string>(firstBarber?.id ?? '');
  const [week, setWeek] = useState<readonly WeekDayEntry[]>(buildDefaultWeek);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirmCount, setPendingConfirmCount] = useState<number | null>(null);

  // This section used to open on a BLANK week for every barber, which made
  // it a trap rather than a form: saving sends the whole week, so any day
  // the owner did not remember to re-tick was silently deleted. Reading the
  // current week first turns the same screen into "here is what he works
  // today, change what you need".
  //
  // A failure here is deliberately NOT surfaced as an error: the section
  // stays usable on the default week, which is exactly the behaviour that
  // existed before. Losing the prefill must never cost the ability to
  // configure a schedule at all.
  useEffect(() => {
    if (!barberId) {
      return;
    }
    let cancelled = false;
    async function loadWeek() {
      try {
        const response = await apiGet<BarberWeekResponse>(`/panel/barbers/${barberId}/schedule`);
        if (cancelled) {
          return;
        }
        const byDay = new Map(response.days.map((day) => [day.dayOfWeek, day]));
        setWeek(
          buildDefaultWeek().map((day) => {
            const configured = byDay.get(day.dayOfWeek);
            return configured
              ? { ...day, enabled: true, opensAt: configured.opensAt, closesAt: configured.closesAt }
              : day;
          }),
        );
      } catch {
        if (!cancelled) {
          setWeek(buildDefaultWeek());
        }
      }
    }
    void loadWeek();
    return () => {
      cancelled = true;
    };
  }, [barberId]);

  async function save(confirm: boolean) {
    const schedule = weekToScheduleDays(week);
    const result = await apiPut<ConfigureBarberWeekResponseBody>(`/panel/barbers/${barberId}/schedule/week`, {
      schedule,
      confirm,
    });
    if (result.configured) {
      setNotice('Horario actualizado correctamente.');
      setPendingConfirmCount(null);
      return;
    }
    // Nothing was written — the owner has to see the count and decide.
    setPendingConfirmCount(result.affectedAppointmentIds.length);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!barberId) {
      return;
    }
    const schedule = weekToScheduleDays(week);
    if (schedule.length === 0) {
      setError('Elegí al menos un día de trabajo.');
      setNotice(null);
      setPendingConfirmCount(null);
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await save(false);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleConfirm() {
    setError(null);
    try {
      await save(true);
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
      {pendingConfirmCount !== null && (
        <p role="alert" className="management__confirm">
          {pendingConfirmCount === 1
            ? 'Hay 1 turno reservado que quedaría sin horario si guardás este cambio.'
            : `Hay ${pendingConfirmCount} turnos reservados que quedarían sin horario si guardás este cambio.`}{' '}
          <button type="button" onClick={() => void handleConfirm()}>
            Guardar igual
          </button>{' '}
          <button type="button" onClick={() => setPendingConfirmCount(null)}>
            Cancelar
          </button>
        </p>
      )}
      <form className="management__form" onSubmit={handleSubmit}>
        <span className="management__field">
          <label htmlFor="mgmt-schedule-barber">Barbero</label>
          <select
            id="mgmt-schedule-barber"
            value={barberId}
            onChange={(e) => {
              setBarberId(e.target.value);
              setPendingConfirmCount(null);
            }}
          >
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

  // The app itself displays prices as "$8.000" (`formatPriceArs`), so that
  // is how the owner types them back — and `Number("8.000")` is 8: the price
  // silently became $8. `parsePriceArsInput` reads the same notation the app
  // writes, and anything it cannot read stops HERE, never at the API.
  const parsedPesos = parsePriceArsInput(priceArs);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!serviceId) {
      return;
    }
    setNotice(null);
    if (parsedPesos === null) {
      setError('No se entendió el precio. Escribilo como 8000 o 8.000.');
      return;
    }
    setError(null);
    try {
      await apiPut(`/panel/services/${serviceId}/price`, { priceCents: Math.round(parsedPesos * 100) });
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
          {/* type="text": a number input rejects "8.000"-style typing in some
              locales and silently accepts it as 8 in others — the text field
              plus the echo below is the only combination where the owner SEES
              what is about to be saved. */}
          <input
            id="mgmt-pricing-price"
            type="text"
            inputMode="numeric"
            required
            value={priceArs}
            onChange={(e) => setPriceArs(e.target.value)}
          />
        </span>
        {parsedPesos !== null && (
          <p className="management__price-echo" role="status">
            Se guarda como <strong>{formatPriceArs(Math.round(parsedPesos * 100))}</strong>
          </p>
        )}
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
/**
 * The four situations a barber's login can be in, derived from the response
 * rather than sent as an enum — the backend has no such field, it reports
 * `userId`/`active`/`activated` and the meaning is the combination.
 *
 * The id travels to the DOM as `data-state` so the badge's colour is not the
 * only carrier: the label says it in words, the attribute makes it
 * assertable, and someone scanning this table for who still cannot get in
 * sees it before reading it.
 */
function accountState(account: {
  readonly userId: string | null;
  readonly active: boolean;
  readonly activated: boolean;
}): { readonly id: string; readonly label: string } {
  if (account.userId === null) {
    return { id: 'sin-cuenta', label: 'Sin cuenta — no puede entrar' };
  }
  if (!account.active) {
    return { id: 'acceso-quitado', label: 'Acceso quitado' };
  }
  if (account.activated) {
    return { id: 'activa', label: 'Activa' };
  }
  return { id: 'sin-activar', label: 'Sin activar — todavía no entró' };
}

function BarberAccountsSection() {
  const [accounts, setAccounts] = useState<readonly BarberAccountResponse[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Email being typed for a barber who has no account yet, keyed by barber. */
  const [pendingEmails, setPendingEmails] = useState<Record<string, string>>({});
  /** The account whose deletion is awaiting confirmation, if any. Deleting
   *  is the one action here that destroys something, so it never happens on
   *  a single click. */
  const [confirmingDelete, setConfirmingDelete] = useState<BarberAccountResponse | null>(null);

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

  async function handleDelete(account: BarberAccountResponse) {
    setError(null);
    setNotice(null);
    try {
      await apiDelete(`/panel/barber-accounts/${account.userId}`);
      setConfirmingDelete(null);
      setNotice(
        `Cuenta de ${account.barberName} eliminada. Sigue en la agenda como barbero sin cuenta: podés volver a invitarlo cuando quieras.`,
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
                  {(() => {
                    const state = accountState(account);
                    return (
                      <span className="management__state" data-state={state.id}>
                        {state.label}
                      </span>
                    );
                  })()}
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
                      <button
                        type="button"
                        className="management__danger"
                        onClick={() => setConfirmingDelete(account)}
                      >
                        Eliminar cuenta
                      </button>
                      {confirmingDelete?.userId === account.userId && (
                        <p className="management__confirm" role="status">
                          ¿Eliminar la cuenta de {account.barberName}? Pierde el acceso al panel y no vas a poder
                          deshacerlo. Sus turnos quedan en la agenda, sin el dato de quién los cargó.{' '}
                          <button type="button" className="management__danger" onClick={() => void handleDelete(account)}>
                            Sí, eliminar
                          </button>{' '}
                          <button type="button" onClick={() => setConfirmingDelete(null)}>
                            Cancelar
                          </button>
                        </p>
                      )}
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
