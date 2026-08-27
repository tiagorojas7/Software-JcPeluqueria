import { useEffect, useState, type FormEvent } from 'react';
import type {
  AccountProfileResponse,
  AvailabilityResponse,
  AvailabilitySlot,
  CheckoutResponseBody,
  ConfirmReservationRequest,
  HoldResponse,
  PublicBarberResponse,
  PublicBarbersResponse,
  PublicServiceResponse,
  PublicServicesResponse,
} from '@jc-barberia/contracts';

import { AccessCodeNotice } from '../booking/AccessCodeNotice';
import { BookingFlowContainer } from '../booking/BookingFlowContainer';
import { BookingSteps, type BookingStepId } from '../booking/BookingSteps';
import { CheckoutStep } from '../booking/CheckoutStep';
import { HoldCountdown } from '../booking/HoldCountdown';
import { apiGet, apiPost, describeError } from '../shared/api-client';
import { formatPriceArs } from '../shared/money';
import { nowMs } from '../shared/now';
import { utcIsoToShopLocalTime } from '../shared/shop-time';
import './BookingPage.css';

/**
 * Public booking flow's page-level composer (client-booking spec,
 * "Exploración sin cuenta" through "Reserva web con seña obligatoria del
 * 50%"). Mounts `BookingFlowContainer` unmodified — it already switches
 * between `AvailabilityPicker` (no hold yet) and `HoldCountdown`+
 * `AccountForm` (hold, no confirmed account) on its own. `BookingFlowContainer`
 * only knows those two states, though: once `clientId` exists this page
 * steps OUTSIDE it and renders `HoldCountdown` + `CheckoutStep` directly,
 * exactly as that container's own doc comment expects of "a page-level
 * caller" deciding what comes next.
 *
 * datos-reales-en-ui: used to default `barberId`/`serviceId` to
 * `shared/demo-data.ts`'s hardcoded first entries. Now fetches
 * `GET /barbers` (active-only) and `GET /services` (real `priceCents`) on
 * mount and defaults the selects to whatever comes back first — a
 * deactivated barber can no longer even be selected, because it is never in
 * the list to begin with.
 *
 * panel-usable: also fetches `GET /account/profile` on mount, best-effort —
 * a returning client (an existing client-session cookie) gets their stored
 * name/phone/email/age handed to `AccountForm` so they confirm once instead
 * of retyping them. ANY failure (403 "not logged in", the ordinary case for
 * a first-time visitor; a genuine network error) is swallowed here and
 * never surfaced as `loadError` — this is the one piece of reference data
 * that is optional by construction: a client with no session keeps today's
 * flow completely untouched.
 */
export function BookingPage() {
  const [barbers, setBarbers] = useState<readonly PublicBarberResponse[] | null>(null);
  const [services, setServices] = useState<readonly PublicServiceResponse[] | null>(null);
  const [accountProfile, setAccountProfile] = useState<AccountProfileResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [barberId, setBarberId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<readonly AvailabilitySlot[]>([]);
  // D.5: distinguishes "todavía no buscaste" from "buscaste y no hay" —
  // `AvailabilityPicker` (apps/web/src/booking/, outside this slice) shows
  // "No hay horarios disponibles" for ANY empty `slots`, with no way to
  // tell those two states apart from its own props. Fixed here, at the
  // page level, by never mounting it (via `BookingFlowContainer`) until a
  // search has actually happened — see the render below.
  const [hasSearched, setHasSearched] = useState(false);
  const [hold, setHold] = useState<HoldResponse | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutResponseBody | null>(null);
  const [tick, setTick] = useState(nowMs());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
        const [firstBarber] = barbersResponse.barbers;
        const [firstService] = servicesResponse.services;
        if (firstBarber) {
          setBarberId(firstBarber.id);
        }
        if (firstService) {
          setServiceId(firstService.id);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(describeError(err));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Best-effort, independent of the barbers/services load above: a returning
  // client's session is optional reference data, never something that can
  // block or fail the booking flow (see this component's own doc comment).
  useEffect(() => {
    let cancelled = false;
    apiGet<AccountProfileResponse>('/account/profile')
      .then((profile) => {
        if (!cancelled) {
          setAccountProfile(profile);
        }
      })
      .catch(() => {
        // No session (403, the ordinary case) or any other failure: the
        // visitor simply gets today's blank-form flow, never an error.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // `HoldCountdown` needs a periodically-refreshed `nowMs` — this page is
  // the composer that owns the interval, per that component's own doc
  // comment. Only ticks while there is a live hold to count down.
  useEffect(() => {
    if (!hold || clientId) {
      return;
    }
    const id = setInterval(() => setTick(nowMs()), 1000);
    return () => clearInterval(id);
  }, [hold, clientId]);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const params = new URLSearchParams({ barberId, serviceId, date });
      const response = await apiGet<AvailabilityResponse>(`/availability?${params.toString()}`);
      setSlots(response.slots);
      setHasSearched(true);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleSelectSlot(slot: AvailabilitySlot) {
    setError(null);
    try {
      const created = await apiPost<HoldResponse>('/holds', {
        barberId,
        serviceId,
        calendarDate: date,
        startTime: utcIsoToShopLocalTime(slot.startsAt),
        endTime: utcIsoToShopLocalTime(slot.endsAt),
      });
      setHold(created);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleConfirmReservation(input: ConfirmReservationRequest) {
    setError(null);
    try {
      const result = await apiPost<{ clientId: string }>('/holds/confirm', input);
      setClientId(result.clientId);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleStartCheckout() {
    if (!hold) {
      return;
    }
    setError(null);
    try {
      const result = await apiPost<CheckoutResponseBody>('/holds/checkout', { holdId: hold.holdId });
      setCheckout(result);
    } catch (err) {
      setError(describeError(err));
    }
  }

  function startOver() {
    setHold(null);
    setClientId(null);
    setCheckout(null);
    setSlots([]);
    setHasSearched(false);
  }

  const referenceDataReady = barbers !== null && services !== null && !loadError;
  const referenceDataEmpty = referenceDataReady && (barbers.length === 0 || services.length === 0);

  // Which stretch of the flow the visitor is in, derived from the state that
  // already drives what is rendered rather than tracked separately — a
  // second source of truth for "where am I" is a second thing that can be
  // wrong.
  const currentStep: BookingStepId = clientId ? 'pagar' : hold ? 'datos' : hasSearched ? 'horario' : 'buscar';

  const selectedBarber = barbers?.find((barber) => barber.id === barberId) ?? null;
  const selectedService = services?.find((service) => service.id === serviceId) ?? null;

  return (
    <div className="booking-page container">
      <div className="booking-page__intro">
        <h2>Reservar turno</h2>
        <p>Elegí barbero, servicio y fecha para ver los horarios libres de hoy.</p>
      </div>

      {referenceDataReady && !referenceDataEmpty && <BookingSteps current={currentStep} />}

      {loadError && <p role="alert">{loadError}</p>}
      {error && <p role="alert">{error}</p>}

      {!loadError && !referenceDataReady && <p className="empty-state">Cargando barberos y servicios...</p>}

      {referenceDataEmpty && (
        <p className="empty-state">Todavía no hay barberos o servicios cargados. Contactá al local.</p>
      )}

      {referenceDataReady && !referenceDataEmpty && (
        <>
          {!hold && (
            <form className="card booking-page__form" onSubmit={handleSearch}>
              <label htmlFor="booking-barber">Barbero</label>
              <select id="booking-barber" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
                {barbers.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.name}
                  </option>
                ))}
              </select>

              <label htmlFor="booking-service">Servicio</label>
              <select id="booking-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} ({formatPriceArs(service.priceCents)})
                  </option>
                ))}
              </select>

              <label htmlFor="booking-date">Fecha</label>
              <input id="booking-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />

              <button type="submit">Ver horarios disponibles</button>
            </form>
          )}

          {/* Once the search has happened the form is replaced by what was
              chosen, so the visitor can check it against what they meant to
              book — and the deposit is stated here, before any data is
              typed, instead of appearing for the first time at checkout. */}
          {(hold || hasSearched) && selectedBarber && selectedService && (
            <dl className="booking-page__selection">
              <div>
                <dt>Servicio</dt>
                <dd>{selectedService.name}</dd>
              </div>
              <div>
                <dt>Barbero</dt>
                <dd>{selectedBarber.name}</dd>
              </div>
              <div>
                <dt>Duración</dt>
                <dd>{selectedService.durationMinutes} min</dd>
              </div>
              <div>
                {/* `depositCents` comes from the server, which computes it
                    with the same rule the checkout charges. Re-deriving 50%
                    here would be a second copy of that rule, free to drift
                    the day it stops being flat. */}
                <dt>Seña</dt>
                <dd>{formatPriceArs(selectedService.depositCents)}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{formatPriceArs(selectedService.priceCents)}</dd>
              </div>
            </dl>
          )}

          {!clientId &&
            (hold || hasSearched ? (
              <div className="card booking-page__results">
                <BookingFlowContainer
                  slots={slots}
                  hold={hold}
                  nowMs={tick}
                  onSelectSlot={handleSelectSlot}
                  onConfirmReservation={handleConfirmReservation}
                  accountProfile={accountProfile}
                />
              </div>
            ) : (
              <p className="empty-state">
                Todavía no buscaste: elegí un barbero, un servicio y una fecha para ver los horarios disponibles.
              </p>
            ))}

          {hold && clientId && (
            <div className="card booking-page__results">
              <HoldCountdown expiresAt={hold.expiresAt} nowMs={tick} />
              <CheckoutStep checkout={checkout} onStartCheckout={handleStartCheckout} />
              {/* cuenta-cliente-persistente: shown as soon as the account exists,
                  because clicking "Pagar la seña ahora" (CheckoutStep) navigates
                  the browser AWAY to MercadoPago — this may be the client's only
                  chance to see this page again before that happens. */}
              <AccessCodeNotice />
            </div>
          )}

          {(hold || checkout) && (
            <p className="booking-page__restart">
              <button type="button" className="btn-ghost" onClick={startOver}>
                Empezar de nuevo
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
