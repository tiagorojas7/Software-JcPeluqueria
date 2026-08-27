import { describe, expect, it } from 'vitest';

import { formatPriceArs, parsePriceArsInput } from './money';

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

// The app itself displays prices as "$8.000" (formatPriceArs above), training
// the owner to type them back the same way — and `Number("8.000")` is 8, a
// thousandfold silent price cut. The parser must read the same Argentine
// notation the formatter writes.
describe('parsePriceArsInput', () => {
  it('reads a plain integer amount', () => {
    expect(parsePriceArsInput('8000')).toBe(8000);
  });

  it('reads the dot-as-thousands notation the app itself displays', () => {
    expect(parsePriceArsInput('8.000')).toBe(8000);
    expect(parsePriceArsInput('12.500')).toBe(12500);
    expect(parsePriceArsInput('1.234.567')).toBe(1234567);
  });

  it('tolerates a leading $ and surrounding spaces', () => {
    expect(parsePriceArsInput(' $ 8.000 ')).toBe(8000);
  });

  it('reads a comma as the decimal separator', () => {
    expect(parsePriceArsInput('8.000,50')).toBe(8000.5);
    expect(parsePriceArsInput('8000,5')).toBe(8000.5);
  });

  it('rejects a dot that is not a thousands group instead of guessing', () => {
    // "8.50" is neither $850 nor $8,50 for sure — refusing beats guessing.
    expect(parsePriceArsInput('8.50')).toBeNull();
    expect(parsePriceArsInput('8.0000')).toBeNull();
  });

  it('rejects empty and non-numeric input', () => {
    expect(parsePriceArsInput('')).toBeNull();
    expect(parsePriceArsInput('   ')).toBeNull();
    expect(parsePriceArsInput('abc')).toBeNull();
    expect(parsePriceArsInput('8000 pesos')).toBeNull();
  });

  it('rejects zero and negatives — a price must be positive', () => {
    expect(parsePriceArsInput('0')).toBeNull();
    expect(parsePriceArsInput('-8000')).toBeNull();
  });
});
