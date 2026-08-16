/**
 * Half-open-ish business-day window, expressed as concrete UTC instants.
 * `start` is the shop's local midnight; `end` is 23:59:59.999 the same
 * local day. Both are computed against the shop's fixed UTC offset, never
 * the machine's local time zone.
 */
export interface BusinessDayBounds {
  start: Date;
  end: Date;
}

/**
 * The only way domain and application code may read "now" or reason about
 * calendar days. No module outside the `ShopClock` adapter may call
 * `Date.now()`, `new Date()`, or `toLocaleString()` directly — see the
 * `no-restricted-syntax` ESLint rule enforcing this at the root config.
 */
export interface Clock {
  /** Current instant, as a UTC `Date`. */
  now(): Date;

  /**
   * UTC instants bounding one shop business day.
   * @param calendarDate ISO calendar date, `YYYY-MM-DD`, interpreted in the
   *   shop's fixed offset (never the server's local time zone).
   */
  businessDayBounds(calendarDate: string): BusinessDayBounds;

  /**
   * The shop calendar date (`YYYY-MM-DD`) that an instant falls on,
   * interpreted in the shop's fixed offset — never the server's local time
   * zone. This is the inverse of `localTimeToUtc`'s date half and the way a
   * cron that fires at a fixed wall-clock instant ("end of the business day")
   * learns WHICH business day it is about to sweep, without any module outside
   * `ShopClock` doing offset math.
   */
  calendarDateOf(instant: Date): string;

  /**
   * Converts a wall-clock time on a given calendar date to the concrete UTC
   * instant it represents in the shop's fixed offset. This is how
   * availability (shop hours, barber schedules) — stored as local wall-clock
   * time — becomes a comparable, bookable `Date`.
   * @param calendarDate ISO calendar date, `YYYY-MM-DD`.
   * @param wallClockTime Local time of day, `HH:mm`.
   */
  localTimeToUtc(calendarDate: string, wallClockTime: string): Date;

  /**
   * Adds (or, with a negative value, subtracts) whole minutes to an instant.
   * No offset/timezone math involved — plain instant arithmetic. This is how
   * a hold's expiry ("now + 15 minutes") is computed without any module outside
   * `ShopClock` constructing a `Date` itself.
   */
  addMinutes(date: Date, minutes: number): Date;

  /**
   * Parses an ISO-8601 instant string (e.g. an outbox payload's
   * `appointmentTime`) to a `Date`. The ONLY way a module that is not
   * `ShopClock`/`FakeClock` recovers a `Date` from a serialized instant — the
   * shared lint rule forbids `new Date(iso)` outside those two, so an outbox
   * consumer or a template must round-trip through here, never parse itself.
   */
  parseInstant(iso: string): Date;

  /**
   * The shop-local wall-clock time (`HH:mm`) a UTC instant falls on — the
   * inverse of `localTimeToUtc`'s time half. Used by the reminder template to
   * render the "última oportunidad" cancel cutoff (turno − 1h) in the shop's
   * own clock, never in UTC: the customer reads shop time, not a timezone
   * offset. Mutually consistent with `calendarDateOf` (the date half).
   */
  wallClockTimeOf(instant: Date): string;
}
