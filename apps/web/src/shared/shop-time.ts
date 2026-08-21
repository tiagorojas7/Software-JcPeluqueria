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
 * Minutes between two ISO UTC instants on the SAME `AvailabilitySlot`
 * (`startsAt`/`endsAt`) — the frontend's only source of a service's
 * duration today (`shared/demo-data.ts`'s `DEMO_SERVICES` carries no
 * duration field). Same pure string/number arithmetic as
 * `utcIsoToShopLocalTime` above, for the same ESLint reason: no `Date`
 * construction anywhere in this file. Wraps around a UTC-midnight crossing
 * the same defensive way that function already does, even though no
 * appointment slot is long enough to make that matter in practice.
 */
export function isoSlotDurationMinutes(startsAt: string, endsAt: string): number {
  const toMinutes = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
  const diffMinutes = toMinutes(endsAt) - toMinutes(startsAt);
  return ((diffMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}
