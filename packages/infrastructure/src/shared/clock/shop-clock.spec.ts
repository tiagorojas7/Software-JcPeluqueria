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

// Hold expiry ("now + 15 minutes") is the main caller, but this is generic
// instant arithmetic — no offset/timezone involved, unlike the two suites
// above. The starting instants still go through `localTimeToUtc` rather than
// `new Date(...)`, which only `ShopClock`/`FakeClock` may call directly.
// The day-end sweep (Phase 6 `59 2 * * *` cron) fires at a fixed wall-clock
// instant and must learn WHICH business day it is about to sweep from that
// instant — the inverse of `businessDayBounds`' date input. A real `Date` is
// fed in on purpose (the same `Date` `now()` returned), never one built here.
describe('ShopClock.calendarDateOf', () => {
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

  it('returns the shop calendar date for an instant in the middle of a business day', () => {
    const clock = new ShopClock();
    // 14:30 Argentina on 2026-08-15 === 17:30 UTC.
    const instant = clock.localTimeToUtc('2026-08-15', '14:30');

    expect(clock.calendarDateOf(instant)).toBe('2026-08-15');
  });

  it('resolves the swept day when the cron fires at 23:55 local (02:55 UTC next UTC day)', () => {
    const clock = new ShopClock();
    // 23:55 Argentina on 2026-08-15 === 02:55 UTC on 2026-08-16. The UTC date
    // has rolled but the business day is still 2026-08-15 — that is the whole
    // reason the sweep needs this method instead of trusting the UTC date.
    const instant = clock.localTimeToUtc('2026-08-15', '23:55');

    expect(clock.calendarDateOf(instant)).toBe('2026-08-15');
  });

  it('rolls into the next business day across local midnight', () => {
    const clock = new ShopClock();
    // 00:01 Argentina on 2026-08-16 === 03:01 UTC — now inside the NEXT day.
    const instant = clock.localTimeToUtc('2026-08-16', '00:01');

    expect(clock.calendarDateOf(instant)).toBe('2026-08-16');
  });
});

describe('ShopClock.addMinutes', () => {
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

  it('adds whole minutes to an instant', () => {
    const clock = new ShopClock();
    const start = clock.localTimeToUtc('2026-08-11', '09:00');

    expect(clock.addMinutes(start, 15).toISOString()).toBe('2026-08-11T12:15:00.000Z');
  });

  it('rolls over into the next hour and subtracts with a negative value', () => {
    const clock = new ShopClock();
    const start = clock.localTimeToUtc('2026-08-11', '09:50');

    expect(clock.addMinutes(start, 15).toISOString()).toBe('2026-08-11T13:05:00.000Z');
    expect(clock.addMinutes(start, -50).toISOString()).toBe('2026-08-11T12:00:00.000Z');
  });
});
