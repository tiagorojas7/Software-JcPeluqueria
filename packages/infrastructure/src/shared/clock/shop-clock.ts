import type { BusinessDayBounds, Clock } from '@jc-barberia/domain';

const DEFAULT_OFFSET = '-03:00';
const OFFSET_PATTERN = /^([+-])(\d{2}):(\d{2})$/;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_CLOCK_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function parseOffsetMinutes(offset: string): number {
  const match = OFFSET_PATTERN.exec(offset);
  if (!match) {
    throw new Error(`Invalid SHOP_UTC_OFFSET "${offset}" — expected format ±HH:MM`);
  }
  const [, sign, hours, minutes] = match;
  const magnitude = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -magnitude : magnitude;
}

function parseCalendarDate(calendarDate: string): { year: number; month: number; day: number } {
  const match = CALENDAR_DATE_PATTERN.exec(calendarDate);
  if (!match) {
    throw new Error(`Invalid calendar date "${calendarDate}" — expected format YYYY-MM-DD`);
  }
  const [, year, month, day] = match;
  return { year: Number(year), month: Number(month), day: Number(day) };
}

function parseWallClockTime(wallClockTime: string): { hour: number; minute: number } {
  const match = WALL_CLOCK_TIME_PATTERN.exec(wallClockTime);
  if (!match) {
    throw new Error(`Invalid wall-clock time "${wallClockTime}" — expected format HH:mm`);
  }
  const [, hour, minute] = match;
  return { hour: Number(hour), minute: Number(minute) };
}

/**
 * The only adapter allowed to read the machine clock directly. Reads a
 * fixed offset from `SHOP_UTC_OFFSET` (default `-03:00`, Argentina, no
 * daylight saving) so the shop's business day never depends on the host
 * machine's time zone or on the IANA tzdb's DST rules.
 */
export class ShopClock implements Clock {
  now(): Date {
    return new Date();
  }

  businessDayBounds(calendarDate: string): BusinessDayBounds {
    const offsetMinutes = parseOffsetMinutes(process.env.SHOP_UTC_OFFSET ?? DEFAULT_OFFSET);
    const { year, month, day } = parseCalendarDate(calendarDate);

    // Local midnight, expressed as UTC millis, then shifted by the offset:
    // UTC = localWallClock - offsetMinutes.
    const startMillis = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMinutes * 60_000;
    const start = new Date(startMillis);

    // 23:59:59.999 the same local day = next local midnight - 1ms.
    const end = new Date(startMillis + 24 * 60 * 60 * 1000 - 1);

    return { start, end };
  }

  // The inverse of `businessDayBounds`' date input: turns the instant the
  // day-end cron fired at into the shop business day it is about to sweep.
  calendarDateOf(instant: Date): string {
    const offsetMinutes = parseOffsetMinutes(process.env.SHOP_UTC_OFFSET ?? DEFAULT_OFFSET);
    // The shop's local wall-clock = UTC + offset (the offset is negative west
    // of UTC: -180 min turns 17:30 UTC into 14:30 Argentina). Reading the UTC
    // components of that shifted instant yields the local calendar date — the
    // inverse of `businessDayBounds`' date input and what the day-end sweep
    // needs to know WHICH business day it is about to close out.
    const local = new Date(instant.getTime() + offsetMinutes * 60_000);
    const yyyy = local.getUTCFullYear();
    const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(local.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  localTimeToUtc(calendarDate: string, wallClockTime: string): Date {
    const offsetMinutes = parseOffsetMinutes(process.env.SHOP_UTC_OFFSET ?? DEFAULT_OFFSET);
    const { year, month, day } = parseCalendarDate(calendarDate);
    const { hour, minute } = parseWallClockTime(wallClockTime);

    // Same shift as businessDayBounds: UTC = localWallClock - offsetMinutes.
    const millis = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offsetMinutes * 60_000;
    return new Date(millis);
  }

  addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60_000);
  }
}
