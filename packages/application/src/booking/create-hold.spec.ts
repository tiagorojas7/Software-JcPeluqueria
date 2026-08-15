import { FakeClock, FakeHoldExpireScheduler, FakeHoldRepository, type TimeWindow } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { CreateHold } from './create-hold';

// A throwaway FakeClock used only to build fixed instants for test data —
// never the one injected into CreateHold itself (each test builds its own).
const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

describe('CreateHold', () => {
  const timeRange: TimeWindow = { start: at('10:00'), end: at('10:30') };
  const searchWindow: TimeWindow = { start: at('09:00'), end: at('18:00') };

  it('claims the slot with a hold expiring exactly 15 minutes from now', async () => {
    const clock = new FakeClock(-180, at('09:45'));
    const holds = new FakeHoldRepository();
    const holdExpire = new FakeHoldExpireScheduler();
    const useCase = new CreateHold(holds, clock, holdExpire);

    const hold = await useCase.execute({
      id: 'hold-1',
      barberId: 'barber-1',
      serviceId: 'service-1',
      clientId: null,
      channel: 'web',
      timeRange,
      searchWindow,
    });

    expect(hold.holdExpiresAt).toEqual(at('10:00'));
    expect(holds.createCalls).toEqual([{ hold, searchWindow }]);
  });

  it('computes expiry relative to whatever "now" is — not a hardcoded instant', async () => {
    const clock = new FakeClock(-180, at('14:20'));
    const holds = new FakeHoldRepository();
    const holdExpire = new FakeHoldExpireScheduler();
    const useCase = new CreateHold(holds, clock, holdExpire);

    const hold = await useCase.execute({
      id: 'hold-2',
      barberId: 'barber-2',
      serviceId: 'service-1',
      clientId: 'client-1',
      channel: 'telefonico',
      timeRange,
      searchWindow,
    });

    expect(hold.holdExpiresAt).toEqual(at('14:35'));
    expect(holds.createCalls[0]?.hold.channel).toBe('telefonico');
    expect(holds.createCalls[0]?.hold.clientId).toBe('client-1');
  });
});

// Phase 6.2 — design.md "Encolado transaccional": creating a hold MUST also
// enqueue a `hold.expire` job scheduled to fire exactly when the hold lapses
// (now + HOLD_DURATION_MINUTES). The `startAfter` is the hold's own expiry,
// so the worker that owns the refund + notification never fires early. The
// transactional-same-statement guarantee is the pg-boss adapter's job
// (proven in infrastructure); here the unit contract is "CreateHold called
// the scheduler with the right holdId and startAfter".
describe('CreateHold — schedules hold.expire', () => {
  const timeRange: TimeWindow = { start: at('10:00'), end: at('10:30') };
  const searchWindow: TimeWindow = { start: at('09:00'), end: at('18:00') };

  it('enqueues hold.expire with startAfter = hold expiry (now + 15 min)', async () => {
    const clock = new FakeClock(-180, at('09:45'));
    const holds = new FakeHoldRepository();
    const scheduler = new FakeHoldExpireScheduler();
    const useCase = new CreateHold(holds, clock, scheduler);

    const hold = await useCase.execute({
      id: 'hold-1',
      barberId: 'barber-1',
      serviceId: 'service-1',
      clientId: null,
      channel: 'web',
      timeRange,
      searchWindow,
    });

    // The hold's expiry is the job's earliest fire time — 10:00 (15 min after 09:45).
    expect(hold.holdExpiresAt).toEqual(at('10:00'));
    expect(scheduler.scheduleCalls).toEqual([
      { holdId: 'hold-1', startAfter: at('10:00') },
    ]);
  });
});
