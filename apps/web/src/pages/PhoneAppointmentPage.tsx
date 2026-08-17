import { useState } from 'react';
import type { CreatePhoneAppointmentRequest, PhoneAppointmentResponse } from '@jc-barberia/contracts';

import { PhoneAppointmentForm } from '../appointments/PhoneAppointmentForm';
import { apiPost, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';

export interface PhoneAppointmentPageProps {
  readonly actor: Actor | null;
}

/** Panel's phone-booking form (admin-operations spec, "Creación de turnos
 *  telefónicos sin seña") — needs `appointment:create` (owner/secretary). */
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
      <section>
        <h2>Turno telefónico (panel)</h2>
        <p>Iniciá sesión como dueño o secretaria para ver esta pantalla.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Turno telefónico (panel)</h2>
      <p>
        IDs de referencia de la demo en <code>docs/DEMO.md</code> (barbero y servicio son campos de texto libre en
        este formulario, tal como ya estaba construido).
      </p>
      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status">
          Turno creado: {result.id} — estado {result.status}.
        </p>
      )}
      <PhoneAppointmentForm onSubmit={handleSubmit} />
    </section>
  );
}
