import { FakeClock, FakeHoldRepository, type TimeWindow } from '@jc-barberia/domain';
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
    const useCase = new CreateHold(holds, clock);

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
    const useCase = new CreateHold(holds, clock);

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
