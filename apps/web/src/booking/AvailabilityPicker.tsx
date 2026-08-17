import type { AvailabilitySlot } from '@jc-barberia/contracts';

export interface AvailabilityPickerProps {
  readonly slots: readonly AvailabilitySlot[];
  readonly onSelectSlot: (slot: AvailabilitySlot) => void;
}

/** `startsAt`/`endsAt` are ISO instants; the visible label is only the
 *  `HH:mm` portion — nothing here re-derives a `Date` or a time zone, the
 *  slice is purely textual on an already-server-computed ISO string. */
function timeLabel(iso: string): string {
  return iso.slice(11, 16);
}

/**
 * Pure presentational component for client-booking's "Exploración sin
 * cuenta" (tasks 9.1/9.2): renders exactly the free schedules the server
 * already computed (`GetPublicAvailabilityUseCase`) and reports a selection
 * back — it never fetches, never asks for a name/phone/email/password, and
 * never decides which schedules are free itself.
 */
export function AvailabilityPicker({ slots, onSelectSlot }: AvailabilityPickerProps) {
  if (slots.length === 0) {
    return <p>No hay horarios disponibles para esta selección.</p>;
  }

  return (
    <ul>
      {slots.map((slot) => (
        <li key={slot.startsAt}>
          <button type="button" onClick={() => onSelectSlot(slot)}>
            {timeLabel(slot.startsAt)} - {timeLabel(slot.endsAt)}
          </button>
        </li>
      ))}
    </ul>
  );
}
