import { describe, expect, it } from 'vitest';

import { FakeClock } from '../shared/ports/testing/fake-clock';
import { bookableSlots, sliceIntoSlots } from './slot-generator';

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

// RED — derived from specs/client-booking/spec.md, not from an
// implementation:
//
//   "Exploración sin cuenta": what a visitor consults are the schedules they
//   can still book. A start time whose instant has already arrived is not one
//   of them — offering it produces an appointment in the past, which no shop
//   can honour. `sliceIntoSlots` only knows the window and the duration, so
//   the "still bookable" half of that requirement lives here, where the
//   `Clock` is the only source of "now".

const nowAt = (time: string) => new FakeClock(-180, at(time));

describe('bookableSlots', () => {
  it('drops the start times that already arrived, keeping the rest of the window', () => {
    const window = { start: at('09:00'), end: at('11:00') };

    const slots = bookableSlots(window, 30, nowAt('10:05'));

    expect(slots).toEqual([
      // 09:00, 09:30 and 10:00 all started before 10:05 — nobody can book
      // a haircut that was supposed to begin already.
      { start: at('10:30'), end: at('11:00') },
    ]);
  });

  it('keeps every slot when the whole window is still ahead', () => {
    const window = { start: at('09:00'), end: at('10:00') };

    const slots = bookableSlots(window, 30, nowAt('08:00'));

    expect(slots).toEqual([
      { start: at('09:00'), end: at('09:30') },
      { start: at('09:30'), end: at('10:00') },
    ]);
  });

  it('drops a slot starting exactly now — its turn has come, it is no longer offerable', () => {
    const window = { start: at('09:00'), end: at('10:00') };

    const slots = bookableSlots(window, 30, nowAt('09:00'));

    expect(slots).toEqual([{ start: at('09:30'), end: at('10:00') }]);
  });

  it('returns no slots at all when the window belongs to a day already gone', () => {
    const window = { start: at('09:00'), end: at('13:00') };

    const slots = bookableSlots(window, 30, nowAt('20:00'));

    expect(slots).toEqual([]);
  });
});
