import type { BusinessDayBounds, Clock } from '../clock.port';

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_CLOCK_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/**
 * Deterministic `Clock` test double mirroring `ShopClock`'s fixed-offset
 * arithmetic (-03:00 by default), for domain-level unit tests. Domain code
 * must never import `packages/infrastructure` (hexagonal boundary,
 * enforced by dependency-cruiser), so tests that need a real UTC instant
 * use this instead of the real adapter. Like `ShopClock`, this is one of
 * the only two places allowed to construct `Date` directly — see the
 * matching `no-restricted-syntax` ESLint override.
 */
export class FakeClock implements Clock {
  constructor(
    private readonly offsetMinutes: number = -180,
    /** Optional fixed instant for `.now()` — unset by default, see below. */
    private readonly fixedNow: Date | null = null,
  ) {}

  now(): Date {
    if (!this.fixedNow) {
      throw new Error(
        'FakeClock.now() has no fixed instant configured — tests should not depend on it',
      );
    }
    return this.fixedNow;
  }

  businessDayBounds(calendarDate: string): BusinessDayBounds {
    const start = this.localTimeToUtc(calendarDate, '00:00');
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { start, end };
  }

  // Inverse of `businessDayBounds`' date input: the shop calendar date a
  // given instant falls on, so the day-end sweep can resolve its target day
  // from `now()` without any caller doing offset math itself.
  calendarDateOf(instant: Date): string {
    // The shop's local wall-clock = UTC + offset (the offset is negative west
    // of UTC, so -180 min turns 17:30 UTC into 14:30 Argentina). Reading the
    // UTC components of that shifted instant yields the local calendar date —
    // the inverse of the `localTimeToUtc` date half, no IANA tzdb involved.
    const local = new Date(instant.getTime() + this.offsetMinutes * 60_000);
    const yyyy = local.getUTCFullYear();
    const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(local.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  localTimeToUtc(calendarDate: string, wallClockTime: string): Date {
    const dateMatch = CALENDAR_DATE_PATTERN.exec(calendarDate);
    const timeMatch = WALL_CLOCK_TIME_PATTERN.exec(wallClockTime);
    if (!dateMatch || !timeMatch) {
      throw new Error(`FakeClock: invalid date "${calendarDate}" or time "${wallClockTime}"`);
    }
    const [, year, month, day] = dateMatch;
    const [, hour, minute] = timeMatch;
    const millis =
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        0,
        0,
      ) -
      this.offsetMinutes * 60_000;
    return new Date(millis);
  }

  addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60_000);
  }
}
