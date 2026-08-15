import { FakeClock, FakeAppointmentSweepRepository } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { DailySweepUseCase } from './daily-sweep';

// Phase 6.6/6.7 — the `59 2 * * *` UTC cron is the day-end sweep: it resolves
// the shop business day that just ended, computes its bounds and forwards
// them to the sweep repository, returning the count transitioned. This suite
// pins the cron's WIRING (now -> calendarDate -> businessDayBounds -> repo ->
// count) without a database. The deposit-agnostic + range-filter contract —
// "con y sin seña" transitioned alike, future days untouched — is the real
// repository's concern and is proven by its Testcontainers suite (6.8/6.9).
describe('DailySweepUseCase', () => {
  // A dateBuilder without a fixed `now` builds instants without depending on
  // the machine clock — the same idiom the other booking suites use; here it
  // pins "now" to 23:55 Argentina on the swept day, the moment the cron fires.
  const dateBuilder = new FakeClock();
  const DAY = '2026-08-15';
  const NOW = dateBuilder.localTimeToUtc(DAY, '23:55');

  it('resolves the business day that just ended from now() and forwards its bounds to the sweep repository', async () => {
    const clock = new FakeClock(-180, NOW);
    const sweep = new FakeAppointmentSweepRepository();
    sweep.returnCount = 3;
    const useCase = new DailySweepUseCase(clock, sweep);

    const count = await useCase.execute();

    expect(count).toBe(3);
    // Exactly one sweep this run, scoped to the day that contains now().
    expect(sweep.receivedBounds).toHaveLength(1);
    expect(sweep.receivedBounds[0]).toEqual(clock.businessDayBounds(DAY));
  });

  // A NEW day boundary: 00:01 Argentina on the next day is already INSIDE the
  // next business day (2026-08-16), so the cron firing then must sweep THAT
  // day, not the one before — proves the job keys off now(), not a fixed date.
  it('sweeps the day corresponding to now(), not a hardcoded one', async () => {
    const nextDayClock = new FakeClock(-180, dateBuilder.localTimeToUtc('2026-08-16', '00:01'));
    const sweep = new FakeAppointmentSweepRepository();
    sweep.returnCount = 1;
    const useCase = new DailySweepUseCase(nextDayClock, sweep);

    await useCase.execute();

    expect(sweep.receivedBounds[0]).toEqual(nextDayClock.businessDayBounds('2026-08-16'));
  });

  // The count the repo returns is the count the job surfaces — the orchestration
  // never invents or drops rows; zero is a legit "nothing to sweep" signal.
  it('surfaces the repository count even when nothing transitioned', async () => {
    const clock = new FakeClock(-180, NOW);
    const sweep = new FakeAppointmentSweepRepository();
    sweep.returnCount = 0;
    const useCase = new DailySweepUseCase(clock, sweep);

    const count = await useCase.execute();

    expect(count).toBe(0);
    expect(sweep.receivedBounds).toHaveLength(1);
  });
});
