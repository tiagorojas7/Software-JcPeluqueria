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
