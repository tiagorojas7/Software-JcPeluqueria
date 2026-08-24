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
