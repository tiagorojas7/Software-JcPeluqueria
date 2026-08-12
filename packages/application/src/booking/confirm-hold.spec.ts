import { FakeClock, FakeHoldRepository, type AvailableCandidate, type Hold } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ConfirmHold } from './confirm-hold';
import { CreateHold } from './create-hold';

const dateBuilder = new FakeClock();
const at = (day: string, time: string) => dateBuilder.localTimeToUtc(day, time);

const originalHold: Hold = {
  id: 'hold-1',
  barberId: 'barber-1',
  serviceId: 'service-1',
  clientId: 'client-1',
  channel: 'web',
  // Late in the day on purpose: a candidate just after local midnight the
  // NEXT day ends up numerically closer than one early the SAME day, which
  // is exactly what lets these tests tell 'any-day' and 'same-day' apart.
  timeRange: { start: at('2026-09-01', '23:00'), end: at('2026-09-01', '23:30') },
  holdExpiresAt: at('2026-09-01', '23:15'),
};

const reofferedSearchWindow = { start: at('2026-09-01', '00:00'), end: at('2026-09-02', '23:59') };

/** `confirm()` always fails — every test here is about the re-validation-failed branch. */
const buildUseCase = () => {
  const holds = new FakeHoldRepository(false);
  const createHold = new CreateHold(holds, new FakeClock(-180, at('2026-09-01', '12:00')));
  return { holds, useCase: new ConfirmHold(holds, createHold) };
};

describe('ConfirmHold', () => {
  it('confirms when the repository transitions the hold from held to reservado', async () => {
    const holds = new FakeHoldRepository(true);
    const createHold = new CreateHold(holds, new FakeClock(-180, at('2026-09-01', '12:00')));
    const useCase = new ConfirmHold(holds, createHold);

    const result = await useCase.execute({
      originalHold,
      originDate: '2026-09-01',
      scope: 'any-day',
      candidates: [],
      reofferedHoldId: 'hold-2',
      reofferedSearchWindow,
    });

    expect(result).toEqual({ outcome: 'confirmed', hold: originalHold });
    expect(holds.createCalls).toEqual([]);
  });

  it('offers the nearest available slot with no day restriction for an ordinary booking', async () => {
    const { holds, useCase } = buildUseCase();
    const sameDayCandidate: AvailableCandidate = {
      date: '2026-09-01',
      window: { start: at('2026-09-01', '09:00'), end: at('2026-09-01', '09:30') },
    };
    // ~23h from the reference the "long way", but only 1h the SHORT way
    // (23:00 -> next day 00:00) — the genuinely nearest option overall.
    const crossDayCandidate: AvailableCandidate = {
      date: '2026-09-02',
      window: { start: at('2026-09-02', '00:00'), end: at('2026-09-02', '00:30') },
    };

    const result = await useCase.execute({
      originalHold,
      originDate: '2026-09-01',
      scope: 'any-day',
      candidates: [sameDayCandidate, crossDayCandidate],
      reofferedHoldId: 'hold-2',
      reofferedSearchWindow,
    });

    if (result.outcome !== 'reoffered') {
      throw new Error(`expected 'reoffered', got '${result.outcome}'`);
    }
    expect(result.hold.timeRange).toEqual(crossDayCandidate.window);
    expect(result.hold.barberId).toBe(originalHold.barberId);
    expect(holds.createCalls).toHaveLength(1);
    expect(holds.createCalls[0]).toMatchObject({
      hold: { id: 'hold-2', timeRange: crossDayCandidate.window },
      searchWindow: reofferedSearchWindow,
    });
  });

  it('restricts the offer to the same calendar day for a barber-absence offer', async () => {
    const { holds, useCase } = buildUseCase();
    const sameDayCandidate: AvailableCandidate = {
      date: '2026-09-01',
      window: { start: at('2026-09-01', '09:00'), end: at('2026-09-01', '09:30') },
    };
    const crossDayCandidate: AvailableCandidate = {
      date: '2026-09-02',
      window: { start: at('2026-09-02', '00:00'), end: at('2026-09-02', '00:30') },
    };

    const result = await useCase.execute({
      originalHold,
      originDate: '2026-09-01',
      scope: 'same-day',
      candidates: [sameDayCandidate, crossDayCandidate],
      reofferedHoldId: 'hold-2',
      reofferedSearchWindow,
    });

    if (result.outcome !== 'reoffered') {
      throw new Error(`expected 'reoffered', got '${result.outcome}'`);
    }
    // The numerically nearer crossDayCandidate must NOT be picked — same-day
    // scope never crosses into another calendar date, even to get closer.
    expect(result.hold.timeRange).toEqual(sameDayCandidate.window);
    expect(holds.createCalls).toHaveLength(1);
  });
});
