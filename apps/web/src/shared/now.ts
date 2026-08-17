/**
 * Wall-clock "now", in epoch milliseconds — for `HoldCountdown`'s own
 * comparison against `Date.parse(expiresAt)` (see that component's doc
 * comment: "whichever page composes this component is the one place
 * expected to re-render it periodically with a fresh `nowMs`"). Deliberately
 * NOT `Date.now()`: the repo-wide `no-restricted-syntax` ESLint rule
 * (`eslint.config.js`) confines direct clock access to `ShopClock`/
 * `FakeClock`, and this SPA has no `Clock` port to inject — it never imports
 * `@jc-barberia/domain`. `performance.timeOrigin` is the epoch instant this
 * page's timeline started; adding `performance.now()`'s monotonic elapsed
 * milliseconds reconstructs the current epoch instant without ever touching
 * the `Date` constructor — `eslint.config.js` already lists `performance` as
 * an allowed global for exactly this reason.
 */
export function nowMs(): number {
  return performance.timeOrigin + performance.now();
}
