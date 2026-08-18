import { useState, type FormEvent } from 'react';
import type { CreateWalkInRequest } from '@jc-barberia/contracts';

export interface WalkInFormProps {
  readonly onSubmit: (input: CreateWalkInRequest) => void;
}

/**
 * B.5's "Carga de walk-ins" panel form. Only barbero y servicio are
 * `required`, matching `CreateWalkInRequestSchema` exactly — cliente stays
 * optional and is sent as `null` rather than blocking submission
 * (appointment-lifecycle spec, "Los walk-ins ingresan directamente como
 * realizado", admin-operations spec, "servicio y barbero" únicos
 * obligatorios). Same container/presentational split as
 * `PhoneAppointmentForm`: reports the built request to `onSubmit`, never
 * calls the API itself.
 */
export function WalkInForm({ onSubmit }: WalkInFormProps) {
  const [barberId, setBarberId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [clientId, setClientId] = useState('');
  const [calendarDate, setCalendarDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      barberId,
      serviceId,
      clientId: clientId.trim() === '' ? null : clientId,
      calendarDate,
      startTime,
      endTime,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="walk-in-barber">Barbero</label>
      <input id="walk-in-barber" required value={barberId} onChange={(e) => setBarberId(e.target.value)} />

      <label htmlFor="walk-in-service">Servicio</label>
      <input id="walk-in-service" required value={serviceId} onChange={(e) => setServiceId(e.target.value)} />

      <label htmlFor="walk-in-client">Cliente (opcional)</label>
      <input id="walk-in-client" value={clientId} onChange={(e) => setClientId(e.target.value)} />

      <label htmlFor="walk-in-date">Fecha</label>
      <input id="walk-in-date" required value={calendarDate} onChange={(e) => setCalendarDate(e.target.value)} />

      <label htmlFor="walk-in-start">Hora de inicio</label>
      <input id="walk-in-start" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />

      <label htmlFor="walk-in-end">Hora de fin</label>
      <input id="walk-in-end" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />

      <button type="submit">Cargar walk-in</button>
    </form>
  );
}
