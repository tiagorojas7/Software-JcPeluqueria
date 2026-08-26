/**
 * Converts an ISO UTC instant (e.g. `AvailabilitySlot.startsAt`) into the
 * shop-local `HH:mm` that `CreateHoldRequestSchema`/
 * `CreatePhoneAppointmentRequestSchema` expect as `startTime`/`endTime`.
 * `AvailabilityPicker.timeLabel()` slices the same ISO string for its
 * on-screen label WITHOUT this offset shift — that is fine for a label, but
 * this page still has to send the ACTUAL shop-local wall-clock time back to
 * `POST /holds`, or it would silently book a different slot than the one the
 * visitor picked (`Clock.localTimeToUtc` on the server re-derives a UTC
 * instant from whatever `HH:mm` this sends).
 *
 * Pure string/number arithmetic — no `Date` construction anywhere in this
 * file, so the repo-wide Clock-only `no-restricted-syntax` ESLint rule never
 * applies. Hardcodes the shop's fixed `-03:00` offset (matches
 * `SHOP_UTC_OFFSET`'s default in
 * `packages/infrastructure/src/shared/clock/shop-clock.ts`): this SPA has no
 * way to read a server-side env var at request time, and JC Barbería's whole
 * domain model already assumes this exact fixed offset with no DST (README,
 * design.md). Every slot the shop ever offers stays within one local
 * calendar day (never crosses local midnight), so the calendar date the
 * visitor already picked never needs adjusting alongside the time — only
 * this file's own `SHOP_UTC_OFFSET_MINUTES` would need updating if a
 * deployment ever overrides `SHOP_UTC_OFFSET`.
 */
const SHOP_UTC_OFFSET_MINUTES = -180;
const MINUTES_PER_DAY = 24 * 60;

export function utcIsoToShopLocalTime(iso: string): string {
  const utcMinutes = Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
  const localMinutes = ((utcMinutes + SHOP_UTC_OFFSET_MINUTES) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hh = String(Math.floor(localMinutes / 60)).padStart(2, '0');
  const mm = String(localMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * The shop-local `DD/MM` of an ISO UTC instant, for lists where the time
 * alone is ambiguous — a client's own turnos are the case that forced it:
 * two "11:00" rows on different days read as the same turno twice.
 *
 * Slicing the ISO date is safe HERE and would not be in general. The shop
 * opens 09:00 and closes 20:00 local, which is 12:00–23:00 UTC at the fixed
 * -03:00 offset, so no appointment instant ever lands near UTC midnight —
 * the only place the offset could push it onto the previous calendar day.
 * Same no-`Date`-construction posture as the rest of this file, so the
 * repo-wide Clock-only ESLint rule never applies.
 */
export function utcIsoToShopLocalDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/**
 * Minutes between two ISO UTC instants on the SAME `AvailabilitySlot`
 * (`startsAt`/`endsAt`) — used where only the slot's own boundaries are on
 * hand, even though `PublicServiceResponse.durationMinutes` now carries a
 * service's real duration from `GET /services`. Same pure string/number
 * arithmetic as `utcIsoToShopLocalTime` above, for the same ESLint reason:
 * no `Date` construction anywhere in this file. Wraps around a UTC-midnight
 * crossing the same defensive way that function already does, even though
 * no appointment slot is long enough to make that matter in practice.
 */
export function isoSlotDurationMinutes(startsAt: string, endsAt: string): number {
  const toMinutes = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
  const diffMinutes = toMinutes(endsAt) - toMinutes(startsAt);
  return ((diffMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}
