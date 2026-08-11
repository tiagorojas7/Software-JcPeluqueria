/**
 * Availability entities and value objects. Pure data + validation — no I/O,
 * no `Clock`, no persistence. Repositories (packages/infrastructure) map
 * these to/from rows; `AvailabilityService` combines them into free slots.
 */

export class AvailabilityValidationError extends Error {}

export const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
/** 0 = Sunday … 6 = Saturday, matching `Date.getUTCDay()` convention. */
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

const WALL_CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new AvailabilityValidationError(`${label} must not be empty`);
  }
}

function assertDayOfWeek(value: number, label: string): asserts value is DayOfWeek {
  if (!DAYS_OF_WEEK.includes(value as DayOfWeek)) {
    throw new AvailabilityValidationError(`${label} must be 0-6 (Sunday-Saturday), got ${value}`);
  }
}

function assertWallClockTime(value: string, label: string): void {
  if (!WALL_CLOCK_TIME_PATTERN.test(value)) {
    throw new AvailabilityValidationError(`${label} must match HH:mm, got "${value}"`);
  }
}

function assertCalendarDate(value: string, label: string): void {
  if (!CALENDAR_DATE_PATTERN.test(value)) {
    throw new AvailabilityValidationError(`${label} must match YYYY-MM-DD, got "${value}"`);
  }
}

/** A day-of-week wall-clock window shared by `ShopHours` and `BarberSchedule`. */
function assertWallClockRange(opensAt: string, closesAt: string, label: string): void {
  assertWallClockTime(opensAt, `${label}.opensAt`);
  assertWallClockTime(closesAt, `${label}.closesAt`);
  if (opensAt >= closesAt) {
    throw new AvailabilityValidationError(
      `${label}: opensAt (${opensAt}) must be before closesAt (${closesAt})`,
    );
  }
}

export interface Barber {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export function createBarber(input: { id: string; name: string; active: boolean }): Barber {
  assertNonEmpty(input.id, 'Barber.id');
  assertNonEmpty(input.name, 'Barber.name');
  return { id: input.id, name: input.name.trim(), active: input.active };
}

export interface Service {
  readonly id: string;
  readonly name: string;
  readonly durationMinutes: number;
  readonly priceCents: number;
}

export function createService(input: {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number;
}): Service {
  assertNonEmpty(input.id, 'Service.id');
  assertNonEmpty(input.name, 'Service.name');
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new AvailabilityValidationError(
      `Service.durationMinutes must be a positive integer, got ${input.durationMinutes}`,
    );
  }
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
    throw new AvailabilityValidationError(
      `Service.priceCents must be a non-negative integer, got ${input.priceCents}`,
    );
  }
  return {
    id: input.id,
    name: input.name.trim(),
    durationMinutes: input.durationMinutes,
    priceCents: input.priceCents,
  };
}

/** The shop's default opening hours for one day of the week. */
export interface ShopHours {
  readonly dayOfWeek: DayOfWeek;
  readonly opensAt: string;
  readonly closesAt: string;
}

export function createShopHours(input: {
  dayOfWeek: DayOfWeek;
  opensAt: string;
  closesAt: string;
}): ShopHours {
  assertDayOfWeek(input.dayOfWeek, 'ShopHours.dayOfWeek');
  assertWallClockRange(input.opensAt, input.closesAt, 'ShopHours');
  return { dayOfWeek: input.dayOfWeek, opensAt: input.opensAt, closesAt: input.closesAt };
}

/** One barber's own working hours for one day of the week. */
export interface BarberSchedule {
  readonly barberId: string;
  readonly dayOfWeek: DayOfWeek;
  readonly opensAt: string;
  readonly closesAt: string;
}

export function createBarberSchedule(input: {
  barberId: string;
  dayOfWeek: DayOfWeek;
  opensAt: string;
  closesAt: string;
}): BarberSchedule {
  assertNonEmpty(input.barberId, 'BarberSchedule.barberId');
  assertDayOfWeek(input.dayOfWeek, 'BarberSchedule.dayOfWeek');
  assertWallClockRange(input.opensAt, input.closesAt, 'BarberSchedule');
  return {
    barberId: input.barberId,
    dayOfWeek: input.dayOfWeek,
    opensAt: input.opensAt,
    closesAt: input.closesAt,
  };
}

/** A barber's day(s) off — a planned free day or a punctual absence. */
export interface BarberTimeOff {
  readonly barberId: string;
  readonly startDate: string;
  readonly endDate: string;
}

export function createBarberTimeOff(input: {
  barberId: string;
  startDate: string;
  endDate: string;
}): BarberTimeOff {
  assertNonEmpty(input.barberId, 'BarberTimeOff.barberId');
  assertCalendarDate(input.startDate, 'BarberTimeOff.startDate');
  assertCalendarDate(input.endDate, 'BarberTimeOff.endDate');
  if (input.startDate > input.endDate) {
    throw new AvailabilityValidationError(
      `BarberTimeOff: startDate (${input.startDate}) must not be after endDate (${input.endDate})`,
    );
  }
  return { barberId: input.barberId, startDate: input.startDate, endDate: input.endDate };
}
