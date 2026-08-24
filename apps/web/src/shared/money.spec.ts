import { describe, expect, it } from 'vitest';

import { formatPriceArs } from './money';

describe('formatPriceArs', () => {
  it('formats whole pesos with a leading $ and a . thousands separator', () => {
    expect(formatPriceArs(800000)).toBe('$8.000');
  });

  it('formats a price below one thousand pesos with no separator', () => {
    expect(formatPriceArs(50000)).toBe('$500');
  });

  it('rounds a fractional cents value to the nearest peso', () => {
    expect(formatPriceArs(123450)).toBe('$1.235');
  });
});
