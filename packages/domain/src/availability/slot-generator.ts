import type { Clock } from '../shared/ports/clock.port';
import type { TimeWindow } from './availability-service';

/**
 * Splits one free working window into consecutive, non-overlapping candidate
 * appointment slots of exactly `durationMinutes` each, starting at
 * `window.start`. A trailing remainder shorter than `durationMinutes` is
 * dropped — it is not a bookable start time for this service.
 *
 * `AvailabilityService.workingWindows` deliberately stops at "is the barber
 * working, and when" (see its own doc comment); occupancy-subtracted free
 * windows (client-booking: "Exploración sin cuenta") still need converting
 * into concrete offerable start times, which is exactly this step. Kept as a
 * pure function, not a method on `AvailabilityService`, because it has
 * nothing to do with shop hours/schedules — only with slicing an already-free
 * window by a service's duration.
 *
 * `Clock.addMinutes` computes every boundary — this module never constructs
 * `Date` itself (the `no-restricted-syntax` rule that confines that to
 * `ShopClock`/`FakeClock`).
 *
 * Pure arithmetic on purpose: it knows nothing about "now", which is exactly
 * why it is NOT re-exported from the package barrel — `bookableSlots` below
 * is the offerable-start-times concept every caller outside this module
 * wants, and keeping the raw slicer module-local is what stops a future
 * caller from silently offering start times that already went by.
 */
export function sliceIntoSlots(window: TimeWindow, durationMinutes: number, clock: Clock): TimeWindow[] {
  const slots: TimeWindow[] = [];
  let cursor = window.start;
  let next = clock.addMinutes(cursor, durationMinutes);
  while (next <= window.end) {
    slots.push({ start: cursor, end: next });
    cursor = next;
    next = clock.addMinutes(cursor, durationMinutes);
  }
  return slots;
}

/**
 * The start times a free window still has on offer: `sliceIntoSlots`'
 * arithmetic minus every slot whose start instant has already arrived.
 *
 * client-booking, "Exploración sin cuenta" — what a visitor consults are the
 * schedules they can still book. A window is free of occupancy for the whole
 * business day, so slicing alone happily produces 09:00 while the shop clock
 * reads 10:30; offering it books an appointment in the past, which no shop
 * can honour and no client can attend. The rule is the same for the panel's
 * phone/walk-in forms and for the same-day absence reassignment offers, so it
 * lives here, once, instead of in each caller.
 *
 * A slot starting exactly at `now` is dropped too: its turn has come, it is
 * no longer something to offer. No minimum notice beyond that is modelled —
 * the shop has never asked for one, and inventing a lead time here would
 * quietly hide slots the barber is perfectly willing to take.
 */
export function bookableSlots(window: TimeWindow, durationMinutes: number, clock: Clock): TimeWindow[] {
  const now = clock.now();
  return sliceIntoSlots(window, durationMinutes, clock).filter((slot) => slot.start > now);
}
