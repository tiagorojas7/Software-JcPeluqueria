/**
 * datos-reales-en-ui: `priceCents` crosses the wire as a plain integer
 * (`PublicServiceResponse.priceCents`) — formatting it for display is this
 * SPA's job, never the server's. Deliberately NOT `Number.prototype
 * .toLocaleString()`: the repo-wide `no-restricted-syntax` ESLint rule
 * (`eslint.config.js`) bans any `toLocaleString()` call outside `ShopClock`/
 * `FakeClock`, so thousands are grouped by hand here instead. Matches the
 * shop's own Argentine peso notation — a literal `$`, no decimals, `.` as the
 * thousands separator — the exact shape `demo-data.ts` used to hardcode
 * (`"Corte clásico ($8.000)"`), now derived from a real integer instead of
 * baked into a display string server-side.
 */
export function formatPriceArs(priceCents: number): string {
  const pesos = Math.round(priceCents / 100);
  const withThousandsSeparators = pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${withThousandsSeparators}`;
}

/**
 * The inverse reading of `formatPriceArs`'s own notation. The app displays
 * "$8.000" everywhere, so that IS how the owner types prices back — and
 * `Number("8.000")` is 8, a thousandfold silent price cut. Dots are accepted
 * ONLY as full thousands groups ("8.000", "1.234.567"); the decimal
 * separator is the comma. Anything ambiguous ("8.50") returns `null` —
 * refusing beats guessing with money.
 */
export function parsePriceArsInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$\s*/, '').trim();
  const match = /^(?<whole>\d{1,3}(?:\.\d{3})+|\d+)(?:,(?<decimals>\d{1,2}))?$/.exec(cleaned);
  if (!match?.groups) {
    return null;
  }
  const whole = match.groups.whole!.replace(/\./g, '');
  const decimals = match.groups.decimals;
  const pesos = Number(decimals ? `${whole}.${decimals}` : whole);
  return pesos > 0 ? pesos : null;
}
