import { describe, expect, it } from 'vitest';

import { FakeClock } from '../shared/ports/testing/fake-clock';
import { sliceIntoSlots } from './slot-generator';

// 9.1 RED — derived from specs/client-booking/spec.md, not from an
// implementation:
//
//   "Exploración sin cuenta": the system MUST let any visitor consult
//   available schedules for a service without an account. Turning a free
//   working window into a list of concrete, bookable start times (one per
//   `Service.durationMinutes`) is the piece `AvailabilityService.workingWindows`
//   explicitly does NOT do (see its own doc comment) — this is that missing
//   step, isolated as a pure function so `GetPublicAvailabilityUseCase` stays
//   free of slicing arithmetic.

const clock = new FakeClock();
const at = (time: string) => clock.localTimeToUtc('2026-09-01', time);

describe('sliceIntoSlots', () => {
  it('slices a free window into consecutive slots of the service duration, dropping a trailing remainder', () => {
    const window = { start: at('09:00'), end: at('10:10') };

    const slots = sliceIntoSlots(window, 30, clock);

    expect(slots).toEqual([
      { start: at('09:00'), end: at('09:30') },
      { start: at('09:30'), end: at('10:00') },
      // 10:00-10:10 is only 10 minutes — shorter than the service, so it is
      // never offered as a bookable start time.
    ]);
  });

  it('returns no slots when the window is shorter than the service duration', () => {
    const window = { start: at('09:00'), end: at('09:20') };

    const slots = sliceIntoSlots(window, 30, clock);

    expect(slots).toEqual([]);
  });

  it('returns exactly one slot when the window matches the duration exactly', () => {
    const window = { start: at('09:00'), end: at('09:30') };

    const slots = sliceIntoSlots(window, 30, clock);

    expect(slots).toEqual([{ start: at('09:00'), end: at('09:30') }]);
  });
});
