import { useState, type FormEvent } from 'react';
import type { CreatePhoneAppointmentRequest } from '@jc-barberia/contracts';

export interface PhoneAppointmentFormProps {
  readonly onSubmit: (input: CreatePhoneAppointmentRequest) => void;
}

/**
 * Task 10.1/10.2's panel form: nombre y teléfono are the only `required`
 * fields, matching `CreatePhoneAppointmentRequestSchema` exactly — email and
 * age stay optional and are sent as `null` rather than omitted or blocking
 * submission (admin-operations spec, "Turno telefónico creado sin email").
 * Purely presentational: it reports the built request to `onSubmit`, never
 * calls the API itself — same container/presentational split as `DayBoard`.
 */
export function PhoneAppointmentForm({ onSubmit }: PhoneAppointmentFormProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [age, setAge] = useState('');
  const [barberId, setBarberId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [calendarDate, setCalendarDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      barberId,
      serviceId,
      calendarDate,
      startTime,
      endTime,
      client: {
        name,
        phone,
        email: email.trim() === '' ? null : email,
        age: age.trim() === '' ? null : Number(age),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="phone-appt-name">Nombre</label>
      <input id="phone-appt-name" required value={name} onChange={(e) => setName(e.target.value)} />

      <label htmlFor="phone-appt-phone">Teléfono</label>
      <input id="phone-appt-phone" required value={phone} onChange={(e) => setPhone(e.target.value)} />

      <label htmlFor="phone-appt-email">Email (opcional)</label>
      <input id="phone-appt-email" value={email} onChange={(e) => setEmail(e.target.value)} />

      <label htmlFor="phone-appt-age">Edad (opcional)</label>
      <input id="phone-appt-age" type="number" value={age} onChange={(e) => setAge(e.target.value)} />

      <label htmlFor="phone-appt-barber">Barbero</label>
      <input id="phone-appt-barber" required value={barberId} onChange={(e) => setBarberId(e.target.value)} />

      <label htmlFor="phone-appt-service">Servicio</label>
      <input id="phone-appt-service" required value={serviceId} onChange={(e) => setServiceId(e.target.value)} />

      <label htmlFor="phone-appt-date">Fecha</label>
      <input id="phone-appt-date" required value={calendarDate} onChange={(e) => setCalendarDate(e.target.value)} />

      <label htmlFor="phone-appt-start">Hora de inicio</label>
      <input id="phone-appt-start" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />

      <label htmlFor="phone-appt-end">Hora de fin</label>
      <input id="phone-appt-end" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />

      <button type="submit">Guardar turno</button>
    </form>
  );
}
