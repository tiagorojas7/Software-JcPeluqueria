import { describe, expect, it } from 'vitest';

import { depositAmountCents } from './deposit-amount';

// client-booking: "Reserva web con seña obligatoria del 50%"
describe('depositAmountCents', () => {
  it('charges exactly half the list price when it divides evenly', () => {
    expect(depositAmountCents(500000)).toBe(250000);
  });

  it('rounds to the nearest cent for an odd list price', () => {
    expect(depositAmountCents(500001)).toBe(250001);
    expect(depositAmountCents(500003)).toBe(250002);
  });
});
