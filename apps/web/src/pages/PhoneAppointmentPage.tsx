import { useState } from 'react';
import type { CreatePhoneAppointmentRequest, PhoneAppointmentResponse } from '@jc-barberia/contracts';

import { PhoneAppointmentForm } from '../appointments/PhoneAppointmentForm';
import { apiPost, describeError } from '../shared/api-client';
import { DEMO_BARBERS, DEMO_SERVICES } from '../shared/demo-data';
import type { Actor } from '../shared/actor';
import './PhoneAppointmentPage.css';

export interface PhoneAppointmentPageProps {
  readonly actor: Actor | null;
}

/** Panel's phone-booking form (admin-operations spec, "Creación de turnos
 *  telefónicos sin seña") — needs `appointment:create` (owner/secretary).
 *  `PhoneAppointmentForm` renders barbero/servicio as real `<select>`s over
 *  `DEMO_BARBERS`/`DEMO_SERVICES`, the same fixed reference data
 *  `BookingPage` already uses — no separate fetch, no reference card to
 *  copy an id from by hand. */
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

      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status">
          Turno creado: {result.id} — estado {result.status}.
        </p>
      )}
      <div className="card phone-appointment-page__form-card">
        <PhoneAppointmentForm barbers={DEMO_BARBERS} services={DEMO_SERVICES} onSubmit={handleSubmit} />
      </div>
    </section>
  );
}
