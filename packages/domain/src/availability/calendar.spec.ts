import { describe, expect, it } from 'vitest';

import { dayOfWeekOf } from './calendar';

// Pure calendar arithmetic — timezone-independent, no Clock involved. Anchor
// dates are well-known, independently verifiable facts (never `new Date()`).
describe('dayOfWeekOf', () => {
  it('resolves 1970-01-01, a well-known Thursday', () => {
    expect(dayOfWeekOf('1970-01-01')).toBe(4);
  });

  it('resolves 2000-01-01, a well-known Saturday', () => {
    expect(dayOfWeekOf('2000-01-01')).toBe(6);
  });

  it('resolves 2024-02-29, the leap-year day, a Thursday', () => {
    expect(dayOfWeekOf('2024-02-29')).toBe(4);
  });

  it('rejects a malformed calendar date', () => {
    expect(() => dayOfWeekOf('2024/02/29')).toThrow(/Invalid calendar date/);
  });
});
