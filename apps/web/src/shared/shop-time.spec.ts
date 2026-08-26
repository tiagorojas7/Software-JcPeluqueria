import { describe, expect, it } from 'vitest';

import { utcIsoToShopLocalDate } from './shop-time';

// A client's "Mi cuenta" list showed only `HH:mm`, so two turnos on
// different days were indistinguishable — the same "11:00" twice. The date
// is derived from the ISO string rather than a `Date`, matching the
// no-`Date`-construction rule the rest of this module already follows.
describe('utcIsoToShopLocalDate', () => {
  it('formats the day and month the way the shop reads it', () => {
    expect(utcIsoToShopLocalDate('2026-05-15T12:00:00.000Z')).toBe('15/05');
  });

  it('keeps the leading zeroes so every date is the same width in a list', () => {
    expect(utcIsoToShopLocalDate('2026-01-05T14:30:00.000Z')).toBe('05/01');
  });

  // The shop opens 09:00 local, which is 12:00 UTC, and closes 20:00 local
  // (23:00 UTC). No appointment instant ever lands close enough to UTC
  // midnight for the -03:00 offset to move it to the previous calendar day,
  // which is exactly why slicing the ISO date is safe here.
  it('agrees with the local date across the whole opening window', () => {
    expect(utcIsoToShopLocalDate('2026-05-15T12:00:00.000Z')).toBe('15/05');
    expect(utcIsoToShopLocalDate('2026-05-15T22:59:00.000Z')).toBe('15/05');
  });
});
