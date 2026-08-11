import type { BusinessDayBounds, Clock } from '@jc-barberia/domain';

const DEFAULT_OFFSET = '-03:00';
const OFFSET_PATTERN = /^([+-])(\d{2}):(\d{2})$/;

function parseOffsetMinutes(offset: string): number {
  const match = OFFSET_PATTERN.exec(offset);
  if (!match) {
    throw new Error(`Invalid SHOP_UTC_OFFSET "${offset}" — expected format ±HH:MM`);
  }
  const [, sign, hours, minutes] = match;
  const magnitude = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -magnitude : magnitude;
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
    const parts = calendarDate.split('-').map(Number);
    const [year, month, day] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    if (!year || !month || !day) {
      throw new Error(`Invalid calendar date "${calendarDate}" — expected format YYYY-MM-DD`);
    }

    // Local midnight, expressed as UTC millis, then shifted by the offset:
    // UTC = localWallClock - offsetMinutes.
    const startMillis = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMinutes * 60_000;
    const start = new Date(startMillis);

    // 23:59:59.999 the same local day = next local midnight - 1ms.
    const end = new Date(startMillis + 24 * 60 * 60 * 1000 - 1);

    return { start, end };
  }
}
