import { useState, type FormEvent } from 'react';
import type { EditAppointmentRequest } from '@jc-barberia/contracts';

export interface EditAppointmentFormValues {
  readonly barberId: string;
  readonly serviceId: string;
  readonly calendarDate: string;
  readonly startTime: string;
  readonly endTime: string;
}

export interface EditAppointmentFormProps {
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
  endTime: '',
};

/**
 * B.3's "Editar turno (servicio, barbero, horario)" — matches
 * `EditAppointmentRequestSchema` exactly. Purely presentational, same
 * container/presentational split as `PhoneAppointmentForm`/`DayBoard`: it
 * never calls the API itself, only reports the built request to `onSubmit`.
 */
export function EditAppointmentForm({ onSubmit, onCancel, initialValues }: EditAppointmentFormProps) {
  const start = initialValues ?? BLANK;
  const [barberId, setBarberId] = useState(start.barberId);
  const [serviceId, setServiceId] = useState(start.serviceId);
  const [calendarDate, setCalendarDate] = useState(start.calendarDate);
  const [startTime, setStartTime] = useState(start.startTime);
  const [endTime, setEndTime] = useState(start.endTime);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ barberId, serviceId, calendarDate, startTime, endTime });
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="edit-appt-barber">Barbero</label>
      <input id="edit-appt-barber" required value={barberId} onChange={(e) => setBarberId(e.target.value)} />

      <label htmlFor="edit-appt-service">Servicio</label>
      <input id="edit-appt-service" required value={serviceId} onChange={(e) => setServiceId(e.target.value)} />

      <label htmlFor="edit-appt-date">Fecha</label>
      <input id="edit-appt-date" required value={calendarDate} onChange={(e) => setCalendarDate(e.target.value)} />

      <label htmlFor="edit-appt-start">Hora de inicio</label>
      <input id="edit-appt-start" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />

      <label htmlFor="edit-appt-end">Hora de fin</label>
      <input id="edit-appt-end" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />

      <button type="submit">Guardar cambios</button>
      <button type="button" onClick={onCancel}>
        Cancelar edición
      </button>
    </form>
  );
}
