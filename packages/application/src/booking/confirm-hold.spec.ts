import { FakeClock, FakeHoldRepository, type Hold } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ConfirmHold } from './confirm-hold';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

const originalHold: Hold = {
  id: 'hold-1',
  barberId: 'barber-1',
  serviceId: 'service-1',
  clientId: 'client-1',
  channel: 'web',
  timeRange: { start: at('10:00'), end: at('10:30') },
  holdExpiresAt: at('10:15'),
};

describe('ConfirmHold', () => {
  it('confirms when the repository transitions the hold from held to reservado', async () => {
    const holds = new FakeHoldRepository(true);
    const useCase = new ConfirmHold(holds);

    const result = await useCase.execute({ originalHold });

    expect(result).toEqual({ outcome: 'confirmed', hold: originalHold });
    expect(holds.confirmCalls).toEqual(['hold-1']);
  });

  it('reports the hold expired, without creating anything, when re-validation fails', async () => {
    const holds = new FakeHoldRepository(false);
    const useCase = new ConfirmHold(holds);

    const result = await useCase.execute({ originalHold });

    expect(result).toEqual({ outcome: 'expired' });
    expect(holds.createCalls).toEqual([]);
  });
});
