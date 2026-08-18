import type { AvailabilitySlot } from '@jc-barberia/contracts';

import { utcIsoToShopLocalTime } from '../shared/shop-time';

export interface AvailabilityPickerProps {
  readonly slots: readonly AvailabilitySlot[];
  readonly onSelectSlot: (slot: AvailabilitySlot) => void;
}

/** `startsAt`/`endsAt` are UTC ISO instants. Slicing `HH:mm` straight out of
 *  the string showed the UTC time to the customer: the shop opens 09:00 and
 *  the page advertised 12:00, because Argentina is UTC-3. The label goes
 *  through the shared shop-offset helper, the same one this flow already uses
 *  when it sends the chosen time back. */
function timeLabel(iso: string): string {
  return utcIsoToShopLocalTime(iso);
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
