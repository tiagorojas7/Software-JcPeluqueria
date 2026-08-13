import { AvailabilityValidationError, type DayOfWeek } from './entities';

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Days elapsed since the Unix epoch (1970-01-01) for a Gregorian calendar
 * date. Pure integer arithmetic (Howard Hinnant's `days_from_civil`) — no
 * `Date` object involved, so this never needs `ShopClock` or the shop's
 * offset: a calendar date's day of week is timezone-independent.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400; // [0, 399]
  const monthOffset = month > 2 ? -3 : 9;
  const doy = Math.floor((153 * (month + monthOffset) + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/**
 * Day of week for a calendar date, `0` (Sunday) … `6` (Saturday) — matches
 * `Date.getUTCDay()` convention. Used to pick which `ShopHours` /
 * `BarberSchedule` row applies to a given date.
 */
export function dayOfWeekOf(calendarDate: string): DayOfWeek {
  const match = CALENDAR_DATE_PATTERN.exec(calendarDate);
  if (!match) {
    throw new AvailabilityValidationError(
      `Invalid calendar date "${calendarDate}" — expected format YYYY-MM-DD`,
    );
  }
  const [, year, month, day] = match;
  const days = daysFromCivil(Number(year), Number(month), Number(day));
  // 1970-01-01 (days = 0) was a Thursday (index 4).
  return (((days + 4) % 7) + 7) % 7 as DayOfWeek;
}
