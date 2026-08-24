import { useState, type FormEvent } from 'react';
import type { EditAppointmentRequest } from '@jc-barberia/contracts';

import { StartTimeField } from '../shared/StartTimeField';

export interface EditAppointmentBarberOption {
  readonly id: string;
  readonly name: string;
}

export interface EditAppointmentServiceOption {
  readonly id: string;
  readonly name: string;
}

export interface EditAppointmentFormValues {
  readonly barberId: string;
  readonly serviceId: string;
  readonly calendarDate: string;
  readonly startTime: string;
}

export interface EditAppointmentFormProps {
  /** Real names to pick from — never a raw id a staff member has to paste. */
  readonly barbers: readonly EditAppointmentBarberOption[];
  readonly services: readonly EditAppointmentServiceOption[];
  readonly onSubmit: (input: EditAppointmentRequest) => void;
  readonly onCancel: () => void;
  /** The slot being edited, so the staff member edits FROM its current
   *  values instead of retyping everything — unlike `PhoneAppointmentForm`
   *  (a brand new booking), this form always starts from an existing turno. */
  readonly initialValues?: EditAppointmentFormValues;
}

const BLANK: EditAppointmentFormValues = {
  barberId: '',
  serviceId: '',
  calendarDate: '',
  startTime: '',
};

/**
 * B.3's "Editar turno (servicio, barbero, horario)" — matches
 * `EditAppointmentRequestSchema` minus `endTime`. Same container/presentational
 * split as `PhoneAppointmentForm`/`DayBoard`: it never POSTs/PUTs itself,
 * only reports the built request to `onSubmit`.
 *
 * panel-usable: barbero/servicio were plain text `<input>`s where staff had
 * to paste a raw UUID — the same developer's harness already removed from
 * every other screen. Now real `<select>`s over the barbers/services the
 * page already loads, a real date input, and `startTime` picked from
 * `GET /availability` through `StartTimeField` instead of typed free text.
 * There is no `endTime` field at all — `EditAppointmentUseCase` derives it
 * from the target service's `durationMinutes`, the same rule
 * `CreatePhoneAppointmentUseCase` already applies.
 *
 * `startTime` starts pre-filled from `initialValues` (the turno's OWN
 * current horario) and is only cleared when the staff member actively
 * changes barbero/servicio/fecha — see `StartTimeField`'s own doc comment
 * for why this form does not try to make that current horario reappear in
 * the picker itself.
 */
export function EditAppointmentForm({ barbers, services, onSubmit, onCancel, initialValues }: EditAppointmentFormProps) {
  const start = initialValues ?? BLANK;
  const [barberId, setBarberId] = useState(start.barberId);
  const [serviceId, setServiceId] = useState(start.serviceId);
  const [calendarDate, setCalendarDate] = useState(start.calendarDate);
  const [startTime, setStartTime] = useState(start.startTime);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!startTime) {
      return;
    }
    onSubmit({ barberId, serviceId, calendarDate, startTime });
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="edit-appt-barber">Barbero</label>
      <select
        id="edit-appt-barber"
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

      <label htmlFor="edit-appt-service">Servicio</label>
      <select
        id="edit-appt-service"
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

      <label htmlFor="edit-appt-date">Fecha</label>
      <input
        id="edit-appt-date"
        type="date"
        required
        value={calendarDate}
        onChange={(e) => {
          setCalendarDate(e.target.value);
          setStartTime('');
        }}
      />

      <StartTimeField
        barberId={barberId}
        serviceId={serviceId}
        calendarDate={calendarDate}
        value={startTime}
        onChange={setStartTime}
      />

      <button type="submit" disabled={!startTime}>
        Guardar cambios
      </button>
      <button type="button" onClick={onCancel}>
        Cancelar edición
      </button>
    </form>
  );
}
