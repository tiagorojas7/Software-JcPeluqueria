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
