import type { AvailabilitySlot } from '@jc-barberia/contracts';

import { isoSlotDurationMinutes, utcIsoToShopLocalTime } from '../shared/shop-time';

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
 *
 * Each slot shows only its START time ("09:00"), never a range — the shop
 * owner's own words: "poné cuándo inicia, no cuándo inicia y termina."
 * Every slot for one search shares the same duration (the service just
 * picked), so it is stated ONCE above the list instead, derived from the
 * first slot's own `startsAt`/`endsAt` — `DEMO_SERVICES` carries no
 * duration field of its own today, so this is the only source the frontend
 * actually has.
 */
export function AvailabilityPicker({ slots, onSelectSlot }: AvailabilityPickerProps) {
  // Destructured rather than indexed: `noUncheckedIndexedAccess` does not
  // narrow `slots[0]` from a `.length` check, and the empty case has to be
  // handled here anyway.
  const [firstSlot] = slots;
  if (!firstSlot) {
    return <p>No hay horarios disponibles para esta selección.</p>;
  }

  const durationMinutes = isoSlotDurationMinutes(firstSlot.startsAt, firstSlot.endsAt);

  return (
    <>
      <p className="availability-picker__duration">Duración del turno: {durationMinutes} min</p>
      <ul>
        {slots.map((slot) => (
          <li key={slot.startsAt}>
            <button type="button" onClick={() => onSelectSlot(slot)}>
              {timeLabel(slot.startsAt)}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
