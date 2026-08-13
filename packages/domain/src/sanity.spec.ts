import { describe, expect, it } from 'vitest';

// Purpose: prove the Vitest runner actually executes and fails on a wrong
// assertion before anything else in the monorepo is built on top of it.
describe('sanity: test runner wiring', () => {
  it('adds two numbers correctly', () => {
    expect(1 + 1).toBe(2);
  });
});
