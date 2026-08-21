import { useState, type FormEvent } from 'react';
import type { CreatePhoneAppointmentRequest } from '@jc-barberia/contracts';

export interface PhoneAppointmentBarberOption {
  readonly id: string;
  readonly name: string;
}

export interface PhoneAppointmentServiceOption {
  readonly id: string;
  readonly name: string;
}

export interface PhoneAppointmentFormProps {
  /** Real names to pick from — never a raw id a secretary has to paste. The
   *  page already loads this the same way `BookingPage` does. */
  readonly barbers: readonly PhoneAppointmentBarberOption[];
  /** `name` already carries the price, the same way `BookingPage` presents
   *  it (`DEMO_SERVICES`'s `"Corte clásico ($8.000)"` shape). */
  readonly services: readonly PhoneAppointmentServiceOption[];
  readonly onSubmit: (input: CreatePhoneAppointmentRequest) => void;
}

/**
 * Task 10.1/10.2's panel form: nombre y teléfono are the only `required`
 * fields, matching `CreatePhoneAppointmentRequestSchema` exactly — email and
 * age stay optional and are sent as `null` rather than omitted or blocking
 * submission (admin-operations spec, "Turno telefónico creado sin email").
 * Purely presentational: it reports the built request to `onSubmit`, never
 * calls the API itself — same container/presentational split as `DayBoard`.
 *
 * paneles-y-turno-telefonico: barbero/servicio are real `<select>`s over the
 * names the page already loaded, not a free-text UUID field a secretary
 * would have to copy from a reference card. There is no end-time field at
 * all — the secretary never has that information on the phone, and
 * `CreatePhoneAppointmentUseCase` derives it server-side from the selected
 * service's `durationMinutes`, so no caller can create a turno whose
 * duration disagrees with its service.
 */
export function PhoneAppointmentForm({ barbers, services, onSubmit }: PhoneAppointmentFormProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [age, setAge] = useState('');
  const [barberId, setBarberId] = useState(barbers[0]?.id ?? '');
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [calendarDate, setCalendarDate] = useState('');
  const [startTime, setStartTime] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      barberId,
      serviceId,
      calendarDate,
      startTime,
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
      <select id="phone-appt-barber" required value={barberId} onChange={(e) => setBarberId(e.target.value)}>
        {barbers.map((barber) => (
          <option key={barber.id} value={barber.id}>
            {barber.name}
          </option>
        ))}
      </select>

      <label htmlFor="phone-appt-service">Servicio</label>
      <select id="phone-appt-service" required value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
        {services.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name}
          </option>
        ))}
      </select>

      <label htmlFor="phone-appt-date">Fecha</label>
      <input
        id="phone-appt-date"
        type="date"
        required
        value={calendarDate}
        onChange={(e) => setCalendarDate(e.target.value)}
      />

      <label htmlFor="phone-appt-start">Hora de inicio</label>
      <input id="phone-appt-start" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />

      <button type="submit">Guardar turno</button>
    </form>
  );
}
