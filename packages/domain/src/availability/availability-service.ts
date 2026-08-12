import type { Clock } from '../shared/ports/clock.port';
import { dayOfWeekOf } from './calendar';
import type { BarberSchedule, BarberTimeOff, ShopHours } from './entities';

export interface WorkingWindowsInput {
  readonly barberId: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly shopHours: readonly ShopHours[];
  readonly barberSchedule: readonly BarberSchedule[];
  readonly timeOff: readonly BarberTimeOff[];
}

/** A working window, as concrete UTC instants. Read-only — no occupancy. */
export interface TimeWindow {
  readonly start: Date;
  readonly end: Date;
}

/**
 * Combines shop hours, one barber's own schedule and their days off into the
 * working window(s) for a given date.
 *
 * IMPORTANT — this does NOT consider occupancy. It answers only "is the
 * barber working, and when", never "what's actually free right now". Holds
 * and booked appointments (`slot_occupancies`, Phase 2) are not subtracted
 * here. Callers MUST NOT treat this result as bookable availability on its
 * own — Phase 2 subtracts occupied ranges from these windows before
 * anything is offered to a client. That's also why this is named
 * `workingWindows`, not `freeSlots`: the previous name implied occupancy
 * was already excluded, which it never was.
 *
 * All time math goes through the injected `Clock` port; this module never
 * touches `Date` directly (enforced by the `no-restricted-syntax` ESLint
 * rule).
 */
export class AvailabilityService {
  constructor(private readonly clock: Clock) {}

  workingWindows(input: WorkingWindowsInput): TimeWindow[] {
    const dayOfWeek = dayOfWeekOf(input.date);

    const shopHoursForDay = input.shopHours.find((h) => h.dayOfWeek === dayOfWeek);
    if (!shopHoursForDay) {
      return [];
    }

    const barberScheduleForDay = input.barberSchedule.find(
      (s) => s.barberId === input.barberId && s.dayOfWeek === dayOfWeek,
    );
    if (!barberScheduleForDay) {
      return [];
    }

    const isOff = input.timeOff.some(
      (t) =>
        t.barberId === input.barberId && t.startDate <= input.date && input.date <= t.endDate,
    );
    if (isOff) {
      return [];
    }

    // HH:mm strings compare lexically the same as their numeric value.
    const effectiveOpen =
      shopHoursForDay.opensAt > barberScheduleForDay.opensAt
        ? shopHoursForDay.opensAt
        : barberScheduleForDay.opensAt;
    const effectiveClose =
      shopHoursForDay.closesAt < barberScheduleForDay.closesAt
        ? shopHoursForDay.closesAt
        : barberScheduleForDay.closesAt;

    if (effectiveOpen >= effectiveClose) {
      return [];
    }

    return [
      {
        start: this.clock.localTimeToUtc(input.date, effectiveOpen),
        end: this.clock.localTimeToUtc(input.date, effectiveClose),
      },
    ];
  }
}
