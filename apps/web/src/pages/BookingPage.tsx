import { useEffect, useState, type FormEvent } from 'react';
import type {
  AvailabilityResponse,
  AvailabilitySlot,
  CheckoutResponseBody,
  ConfirmReservationRequest,
  HoldResponse,
} from '@jc-barberia/contracts';

import { AccessCodeNotice } from '../booking/AccessCodeNotice';
import { BookingFlowContainer } from '../booking/BookingFlowContainer';
import { CheckoutStep } from '../booking/CheckoutStep';
import { HoldCountdown } from '../booking/HoldCountdown';
import { apiGet, apiPost, describeError } from '../shared/api-client';
import { DEMO_BARBERS, DEMO_SERVICES } from '../shared/demo-data';
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
 */
export function BookingPage() {
  const [barberId, setBarberId] = useState<string>(DEMO_BARBERS[0].id);
  const [serviceId, setServiceId] = useState<string>(DEMO_SERVICES[0].id);
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

  return (
    <div className="booking-page container">
      <div className="booking-page__intro">
        <h2>Reservar turno</h2>
        <p>Elegí barbero, servicio y fecha para ver los horarios libres de hoy.</p>
      </div>

      {error && <p role="alert">{error}</p>}

      {!hold && (
        <form className="card booking-page__form" onSubmit={handleSearch}>
          <label htmlFor="booking-barber">Barbero</label>
          <select id="booking-barber" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
            {DEMO_BARBERS.map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.name}
              </option>
            ))}
          </select>

          <label htmlFor="booking-service">Servicio</label>
          <select id="booking-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {DEMO_SERVICES.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>

          <label htmlFor="booking-date">Fecha</label>
          <input id="booking-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />

          <button type="submit">Ver horarios disponibles</button>
        </form>
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
    </div>
  );
}
