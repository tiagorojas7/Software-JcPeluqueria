import type { AvailabilitySlot } from '@jc-barberia/contracts';

import { AvailabilityPicker } from '../booking/AvailabilityPicker';
import { useAvailabilitySlots } from './use-availability-slots';
import { utcIsoToShopLocalTime } from './shop-time';

export interface StartTimeFieldProps {
  readonly barberId: string;
  readonly serviceId: string;
  readonly calendarDate: string;
  /** Shop-local `HH:mm`, or `''` when nothing has been chosen yet. */
  readonly value: string;
  readonly onChange: (startTime: string) => void;
}

/**
 * panel-usable: replaces the free-text "Hora de inicio" `<input>` every
 * panel form used to have — typing "10", "10:00 am" or anything that did not
 * match `^\d{2}:\d{2}$` was a 400 with no explanation, the exact bug the
 * shop owner hit. Renders only the horarios `GET /availability` actually
 * reports as free for the barbero/servicio/fecha already chosen
 * (`useAvailabilitySlots`), through the SAME `AvailabilityPicker` the public
 * booking page already uses — one source of truth for "what is free", never
 * a second one invented for the panel.
 *
 * Deliberately does not try to make an appointment's OWN current horario
 * reappear when editing without changing barbero/servicio/fecha: that slot
 * is occupied by the very appointment being edited, so `GET /availability`
 * correctly does not offer it back. Inventing a client-side exception for
 * that case would be exactly the "second source of truth" this component is
 * meant to avoid — the caller (`EditAppointmentForm`) keeps the original
 * `startTime` as this field's initial `value` instead, so submitting
 * without touching the picker still sends a value the server already knows
 * is legal.
 */
export function StartTimeField({ barberId, serviceId, calendarDate, value, onChange }: StartTimeFieldProps) {
  const { slots, loading, error } = useAvailabilitySlots(barberId, serviceId, calendarDate);

  function handleSelect(slot: AvailabilitySlot) {
    onChange(utcIsoToShopLocalTime(slot.startsAt));
  }

  return (
    <fieldset className="start-time-field">
      <legend>Hora de inicio</legend>
      {!calendarDate && (
        <p className="empty-state">Elegí un barbero, un servicio y una fecha para ver los horarios libres.</p>
      )}
      {calendarDate && loading && <p className="empty-state">Buscando horarios libres...</p>}
      {calendarDate && error && <p role="alert">{error}</p>}
      {calendarDate && !loading && !error && <AvailabilityPicker slots={slots} onSelectSlot={handleSelect} />}
      {value && <p role="status">Hora elegida: {value}</p>}
    </fieldset>
  );
}
