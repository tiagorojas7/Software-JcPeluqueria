import { MIN_PASSWORD_LENGTH } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import {
  BARBER_SCHEDULES,
  DEMO_BARBERS,
  DEMO_SERVICES,
  SHOP_HOURS,
  STAFF_ACCOUNTS,
} from './seed-data';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WALL_CLOCK_PATTERN = /^\d{2}:\d{2}$/;

function toMinutes(wallClockTime: string): number {
  const parts = wallClockTime.split(':').map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/**
 * The one piece of `db/seed.ts` that is real data-shaping logic, not pure
 * I/O (see that script's own doc comment) — every invariant here is one the
 * seed script's `onConflictDoUpdate` calls silently assume hold, and a typo
 * in the raw literal data would otherwise only surface as a confusing
 * runtime failure against a real database, or worse, a demo screen that
 * quietly shows wrong data.
 */
describe('seed-data', () => {
  it('gives every demo barber a well-formed, unique id', () => {
    const ids = DEMO_BARBERS.map((barber) => barber.id);
    for (const id of ids) {
      expect(id).toMatch(UUID_PATTERN);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every demo service a well-formed id, a positive price in cents, and a positive duration', () => {
    const ids = DEMO_SERVICES.map((service) => service.id);
    for (const id of ids) {
      expect(id).toMatch(UUID_PATTERN);
    }
    expect(new Set(ids).size).toBe(ids.length);

    for (const service of DEMO_SERVICES) {
      expect(Number.isInteger(service.priceCents)).toBe(true);
      expect(service.priceCents).toBeGreaterThan(0);
      expect(Number.isInteger(service.durationMinutes)).toBe(true);
      expect(service.durationMinutes).toBeGreaterThan(0);
    }
  });

  it('opens the shop Monday through Saturday only, with opensAt before closesAt every day', () => {
    const daysOfWeek = SHOP_HOURS.map((row) => row.dayOfWeek).sort((a, b) => a - b);
    expect(daysOfWeek).toEqual([1, 2, 3, 4, 5, 6]); // closed Sunday (0) — horario corrido, one row per day

    for (const row of SHOP_HOURS) {
      expect(row.opensAt).toMatch(WALL_CLOCK_PATTERN);
      expect(row.closesAt).toMatch(WALL_CLOCK_PATTERN);
      expect(toMinutes(row.opensAt)).toBeLessThan(toMinutes(row.closesAt));
    }
  });

  it('only schedules barbers who exist in DEMO_BARBERS, each with opensAt before closesAt', () => {
    const knownBarberIds = new Set(DEMO_BARBERS.map((barber) => barber.id));

    for (const row of BARBER_SCHEDULES) {
      expect(knownBarberIds.has(row.barberId)).toBe(true);
      expect(row.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(row.dayOfWeek).toBeLessThanOrEqual(6);
      expect(row.opensAt).toMatch(WALL_CLOCK_PATTERN);
      expect(row.closesAt).toMatch(WALL_CLOCK_PATTERN);
      expect(toMinutes(row.opensAt)).toBeLessThan(toMinutes(row.closesAt));
    }
  });

  it('never schedules the same barber on the same day of week twice (matches the DB unique constraint)', () => {
    const keys = BARBER_SCHEDULES.map((row) => `${row.barberId}:${row.dayOfWeek}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every staff account a unique email and a password meeting MIN_PASSWORD_LENGTH', () => {
    const emails = STAFF_ACCOUNTS.map((account) => account.email);
    expect(new Set(emails).size).toBe(emails.length);

    for (const account of STAFF_ACCOUNTS) {
      expect(account.password.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    }
  });

  it('only attaches a barberId to a barber-role account, and always to a known barber', () => {
    const knownBarberIds = new Set(DEMO_BARBERS.map((barber) => barber.id));

    for (const account of STAFF_ACCOUNTS) {
      if (account.role === 'barber') {
        expect(account.barberId).not.toBeNull();
        expect(knownBarberIds.has(account.barberId as string)).toBe(true);
      } else {
        expect(account.barberId).toBeNull();
      }
    }
  });
});
