import { useState, type FormEvent } from 'react';
import type { CreateWalkInRequest } from '@jc-barberia/contracts';

import { BarberWorkingDays } from '../shared/BarberWorkingDays';
import { StartTimeField } from '../shared/StartTimeField';

export interface WalkInBarberOption {
  readonly id: string;
  readonly name: string;
}

export interface WalkInServiceOption {
  readonly id: string;
  readonly name: string;
}

export interface WalkInFormProps {
  readonly barbers: readonly WalkInBarberOption[];
  readonly services: readonly WalkInServiceOption[];
  readonly onSubmit: (input: CreateWalkInRequest) => void;
}

/**
 * B.5's "Carga de walk-ins" panel form. Only barbero y servicio are
 * `required`, matching `CreateWalkInRequestSchema` exactly — cliente stays
 * optional and never blocks submission (appointment-lifecycle spec, "Los
 * walk-ins ingresan directamente como realizado", admin-operations spec,
 * "servicio y barbero" únicos obligatorios). Same container/presentational
 * split as `PhoneAppointmentForm`: reports the built request to `onSubmit`,
 * never calls the API itself except for `StartTimeField`'s read-only
 * `GET /availability` lookup.
 *
 * panel-usable: barbero/servicio were plain text `<input>`s where staff had
 * to paste a raw UUID; `clientId` asked for another one, for a person who
 * showed up WITHOUT an appointment and has no id to give. All three are
 * gone. Barbero/servicio are real `<select>`s, the date is a real date
 * input, `startTime` comes from `GET /availability` through
 * `StartTimeField`, and the client field now asks for a phone number —
 * `CreateWalkInUseCase` looks up an existing client by it and leaves the
 * walk-in unidentified when there is no match, never fabricating a client
 * record from a phone number alone (see that use case's own doc comment).
 * There is no `endTime` field either: the target service's
 * `durationMinutes` derives it server-side.
 */
export function WalkInForm({ barbers, services, onSubmit }: WalkInFormProps) {
  const [barberId, setBarberId] = useState(barbers[0]?.id ?? '');
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [clientPhone, setClientPhone] = useState('');
  const [calendarDate, setCalendarDate] = useState('');
  const [startTime, setStartTime] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!startTime) {
      return;
    }
    onSubmit({
      barberId,
      serviceId,
      clientPhone: clientPhone.trim() === '' ? null : clientPhone,
      calendarDate,
      startTime,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="walk-in-barber">Barbero</label>
      <select
        id="walk-in-barber"
        required
        value={barberId}
        onChange={(e) => {
          setBarberId(e.target.value);
          setStartTime('');
        }}
      >
        {barbers.map((barber) => (
          <option key={barber.id} value={barber.id}>
            {barber.name}
          </option>
        ))}
      </select>

      <label htmlFor="walk-in-service">Servicio</label>
      <select
        id="walk-in-service"
        required
        value={serviceId}
        onChange={(e) => {
          setServiceId(e.target.value);
          setStartTime('');
        }}
      >
        {services.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name}
          </option>
        ))}
      </select>

      <label htmlFor="walk-in-client">Teléfono del cliente (opcional)</label>
      <input id="walk-in-client" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />

      <label htmlFor="walk-in-date">Fecha</label>
      <input
        id="walk-in-date"
        type="date"
        required
        value={calendarDate}
        onChange={(e) => {
          setCalendarDate(e.target.value);
          setStartTime('');
        }}
      />

      {/* The native date input cannot grey out the days this barber does
          not work, so the answer is stated in words instead — before a date
          is picked, and again as a warning once one lands on a day he does
          not attend. Without it, "no hay horarios" was the only feedback,
          and it reads identically to "that day is full". */}
      <BarberWorkingDays barberId={barberId} calendarDate={calendarDate} />

      <StartTimeField
        barberId={barberId}
        serviceId={serviceId}
        calendarDate={calendarDate}
        value={startTime}
        onChange={setStartTime}
      />

      <button type="submit" disabled={!startTime}>
        Cargar walk-in
      </button>
    </form>
  );
}
