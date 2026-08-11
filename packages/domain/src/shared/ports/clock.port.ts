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
}
