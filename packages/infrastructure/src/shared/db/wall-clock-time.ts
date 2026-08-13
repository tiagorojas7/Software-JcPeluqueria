/**
 * Postgres' `time` column returns `HH:MM:SS[.ffffff]` as text. The domain
 * only ever speaks `HH:mm` (see `packages/domain/src/availability/entities.ts`),
 * so every row read against a `time` column is normalized through this
 * before it reaches a domain validating factory — a row so malformed the
 * domain wouldn't accept it then fails loudly on read, not silently.
 */
export function toWallClockTime(value: string): string {
  return value.slice(0, 5);
}
