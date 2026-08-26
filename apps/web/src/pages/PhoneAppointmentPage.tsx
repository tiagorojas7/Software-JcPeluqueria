import { useEffect, useState } from 'react';
import type {
  CreatePhoneAppointmentRequest,
  PhoneAppointmentResponse,
  PublicBarberResponse,
  PublicBarbersResponse,
  PublicServiceResponse,
  PublicServicesResponse,
} from '@jc-barberia/contracts';

import { PhoneAppointmentForm } from '../appointments/PhoneAppointmentForm';
import { apiGet, apiPost, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';
import { appointmentStatusLabel } from '../shared/appointment-status';
import { utcIsoToShopLocalDate, utcIsoToShopLocalTime } from '../shared/shop-time';
import './PhoneAppointmentPage.css';

export interface PhoneAppointmentPageProps {
  readonly actor: Actor | null;
}

/**
 * Resolves the name behind one of the ids the created turno comes back with.
 * `PhoneAppointmentResponse` carries `barberId`/`serviceId` raw, but this
 * screen already holds both catalogues — it fetched them to build the form —
 * so the lookup costs nothing and no request is added.
 *
 * Falls back to the id rather than to an empty string: on the one-in-a-
 * thousand case where a barber was deactivated between loading the form and
 * submitting it, an unhelpful id still beats a sentence with a hole in it.
 */
function nameOf(catalogue: readonly { id: string; name: string }[] | null, id: string): string {
  return catalogue?.find((entry) => entry.id === id)?.name ?? id;
}

/** Panel's phone-booking form (admin-operations spec, "Creación de turnos
 *  telefónicos sin seña") — needs `appointment:create` (owner/secretary).
 *
 *  datos-reales-en-ui: used to feed `PhoneAppointmentForm` from
 *  `shared/demo-data.ts` — the same stale, hardcoded reference data
 *  `BookingPage` used to. Now fetches `GET /barbers` (active-only) and
 *  `GET /services` on mount, same `apiGet` every other page uses, and
 *  passes the real records through unchanged — `PhoneAppointmentForm`'s own
 *  `{ id, name }` prop shape needed no change at all. */
export function PhoneAppointmentPage({ actor }: PhoneAppointmentPageProps) {
  const [barbers, setBarbers] = useState<readonly PublicBarberResponse[] | null>(null);
  const [services, setServices] = useState<readonly PublicServiceResponse[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<PhoneAppointmentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!actor) {
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
          setLoadError(describeError(err));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [actor]);

  async function handleSubmit(input: CreatePhoneAppointmentRequest) {
    setError(null);
    setResult(null);
    try {
      const created = await apiPost<PhoneAppointmentResponse>('/appointments/phone', input);
      setResult(created);
    } catch (err) {
      setError(describeError(err));
    }
  }

  if (!actor) {
    return (
      <section className="panel-page">
        <h2>Turno telefónico</h2>
        <p className="empty-state">Iniciá sesión como dueño o secretaria para ver esta pantalla.</p>
      </section>
    );
  }

  const referenceDataReady = barbers !== null && services !== null && !loadError;
  const referenceDataEmpty = referenceDataReady && (barbers.length === 0 || services.length === 0);

  return (
    <section className="panel-page">
      <h2>Turno telefónico</h2>
      <p>Para cuando un cliente llama y no quiere (o no puede) reservar online.</p>

      {error && <p role="alert">{error}</p>}
      {loadError && <p role="alert">{loadError}</p>}

      {/* Whoever is using this screen is on the phone with the client right
          now, so the answer has to be the sentence they are about to read
          out loud — not the row's primary key and the database's own word
          for its state, which is what this used to show. The names are
          resolved from the very lists that populated the form, so no extra
          request is needed. */}
      {result && (
        <div className="card phone-appointment-page__result" role="status" aria-label="Turno creado">
          <p className="phone-appointment-page__result-status">{appointmentStatusLabel(result.status)}</p>
          <p className="phone-appointment-page__result-headline">
            {nameOf(services, result.serviceId)} con {nameOf(barbers, result.barberId)}
          </p>
          <p className="phone-appointment-page__result-when">
            {utcIsoToShopLocalDate(result.startsAt)} a las {utcIsoToShopLocalTime(result.startsAt)} hs
          </p>
          <p className="phone-appointment-page__result-note">
            Queda sin seña: se cobra todo en el local.
          </p>
          <button type="button" onClick={() => setResult(null)}>
            Cargar otro turno
          </button>
        </div>
      )}

      {!loadError && !referenceDataReady && <p className="empty-state">Cargando barberos y servicios...</p>}
      {referenceDataEmpty && (
        <p className="empty-state">Todavía no hay barberos o servicios cargados. Contactá al local.</p>
      )}

      {referenceDataReady && !referenceDataEmpty && !result && (
        <div className="card phone-appointment-page__form-card">
          <PhoneAppointmentForm barbers={barbers} services={services} onSubmit={handleSubmit} />
        </div>
      )}
    </section>
  );
}
