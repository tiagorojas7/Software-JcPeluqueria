import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ShopClock } from './shop-clock';

// ShopClock is the ONLY place allowed to depend on SHOP_UTC_OFFSET / the
// machine clock. Every test freezes/sets the env var explicitly so results
// never depend on the machine's own time zone.
describe('ShopClock.businessDayBounds', () => {
  const originalOffset = process.env.SHOP_UTC_OFFSET;

  beforeEach(() => {
    process.env.SHOP_UTC_OFFSET = '-03:00';
  });

  afterEach(() => {
    if (originalOffset === undefined) {
      delete process.env.SHOP_UTC_OFFSET;
    } else {
      process.env.SHOP_UTC_OFFSET = originalOffset;
    }
  });

  it('returns the UTC instants for local midnight and local 23:59:59.999 on an ordinary day', () => {
    const clock = new ShopClock();

    const { start, end } = clock.businessDayBounds('2026-08-11');

    // 2026-08-11T00:00:00.000-03:00 === 2026-08-11T03:00:00.000Z
    expect(start.toISOString()).toBe('2026-08-11T03:00:00.000Z');
    // 2026-08-11T23:59:59.999-03:00 === 2026-08-12T02:59:59.999Z
    expect(end.toISOString()).toBe('2026-08-12T02:59:59.999Z');
  });

  it('rolls over correctly across a month boundary (day edge)', () => {
    const clock = new ShopClock();

    const { start, end } = clock.businessDayBounds('2026-01-31');

    // 2026-01-31T00:00:00.000-03:00 === 2026-01-31T03:00:00.000Z
    expect(start.toISOString()).toBe('2026-01-31T03:00:00.000Z');
    // 2026-01-31T23:59:59.999-03:00 === 2026-02-01T02:59:59.999Z — crosses into February
    expect(end.toISOString()).toBe('2026-02-01T02:59:59.999Z');
  });
});

// Availability (shop hours, barber schedules) is stored as local wall-clock
// time. This is the only place that time is allowed to become a `Date`.
describe('ShopClock.localTimeToUtc', () => {
  const originalOffset = process.env.SHOP_UTC_OFFSET;

  beforeEach(() => {
    process.env.SHOP_UTC_OFFSET = '-03:00';
  });

  afterEach(() => {
    if (originalOffset === undefined) {
      delete process.env.SHOP_UTC_OFFSET;
    } else {
      process.env.SHOP_UTC_OFFSET = originalOffset;
    }
  });

  it('converts an ordinary wall-clock time to the matching UTC instant', () => {
    const clock = new ShopClock();

    // 2026-08-11T09:00:00-03:00 === 2026-08-11T12:00:00.000Z
    expect(clock.localTimeToUtc('2026-08-11', '09:00').toISOString()).toBe(
      '2026-08-11T12:00:00.000Z',
    );
  });

  it('rolls the UTC date forward when the local time crosses midnight UTC', () => {
    const clock = new ShopClock();

    // 2026-01-31T23:30:00-03:00 === 2026-02-01T02:30:00.000Z — crosses into
    // the next UTC day (and month) even though the local calendar date is
    // still 2026-01-31.
    expect(clock.localTimeToUtc('2026-01-31', '23:30').toISOString()).toBe(
      '2026-02-01T02:30:00.000Z',
    );
  });

  it('rejects a wall-clock time that does not match HH:mm', () => {
    const clock = new ShopClock();

    expect(() => clock.localTimeToUtc('2026-08-11', '9:00')).toThrow(/Invalid wall-clock time/);
  });
});
