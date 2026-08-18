import { useState } from 'react';
import type { CreatePhoneAppointmentRequest, PhoneAppointmentResponse } from '@jc-barberia/contracts';

import { PhoneAppointmentForm } from '../appointments/PhoneAppointmentForm';
import { apiPost, describeError } from '../shared/api-client';
import { DEMO_BARBERS, DEMO_SERVICES } from '../shared/demo-data';
import type { Actor } from '../shared/actor';

export interface PhoneAppointmentPageProps {
  readonly actor: Actor | null;
}

/** Panel's phone-booking form (admin-operations spec, "Creación de turnos
 *  telefónicos sin seña") — needs `appointment:create` (owner/secretary).
 *  `PhoneAppointmentForm` (not owned by this slice) takes barbero/servicio
 *  as free-text ids, not a picker — the reference card below is this
 *  page's own addition so a secretary typing them by hand has something to
 *  copy from without leaving the screen. */
export function PhoneAppointmentPage({ actor }: PhoneAppointmentPageProps) {
  const [result, setResult] = useState<PhoneAppointmentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="panel-page">
      <h2>Turno telefónico</h2>
      <p>Para cuando un cliente llama y no quiere (o no puede) reservar online.</p>

      <div className="card panel-page__reference">
        <h3>Barberos y servicios</h3>
        <div className="panel-page__reference-grid">
          <div>
            <strong>Barberos</strong>
            <ul>
              {DEMO_BARBERS.map((barber) => (
                <li key={barber.id}>
                  {barber.name} — <code>{barber.id}</code>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <strong>Servicios</strong>
            <ul>
              {DEMO_SERVICES.map((service) => (
                <li key={service.id}>
                  {service.name} — <code>{service.id}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status">
          Turno creado: {result.id} — estado {result.status}.
        </p>
      )}
      <div className="card">
        <PhoneAppointmentForm onSubmit={handleSubmit} />
      </div>
    </section>
  );
}
