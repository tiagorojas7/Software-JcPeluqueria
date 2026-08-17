import { FakeClock, type Hold } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { MarkBarberAbsentUseCase } from './mark-barber-absent';
import { CreateHold } from './create-hold';

const dateBuilder = new FakeClock();
const at = (day: string, time: string) => dateBuilder.localTimeToUtc(day, time);

const makeHold = (overrides: Partial<Hold> = {}): Hold => ({
  id: 'hold-1',
  barberId: 'barber-1',
  serviceId: 'service-1',
  clientId: null,
  channel: 'web' as const,
  timeRange: { start: at('2026-09-01', '10:00'), end: at('2026-09-01', '10:30') },
  holdExpiresAt: new Date(at('2026-09-01', '10:45')),
  ...overrides,
});

describe('AbsenceReassignment — RED (task 12.3)', () => {
  it('generates same-day hold offers with origin_occupancy_id for each affected slot', async () => {
    const clock = new FakeClock(-180, at('2026-09-01', '10:00'));

    const affectedSlots: Hold[] = [
      makeHold({ id: 'original-1', barberId: 'barber-1', timeRange: { start: at('2026-09-01', '10:00'), end: at('2026-09-01', '10:30') } }),
    ];

    // WHEN: we generate offers for each affected slot
    // THEN: each offer should be a hold with origin_occupancy_id pointing to the original
    const offerIds: string[] = [];

    for (const original of affectedSlots) {
      // Mock createHold to capture the origin_occupancy_id
      const createHold = new CreateHold(
        {
          create: async (hold: Hold, searchWindow: import('@jc-barberia/domain').TimeWindow) => {
            // The hold should have origin_occupancy_id set
            const originId = (hold as any).origin_occupancy_id;
            offerIds.push(originId);
            return { id: 'new-hold-1', ...hold } as Hold;
          },
        },
        clock,
      );

      await createHold.execute({
        id: 'offer-1',
        barberId: original.barberId,
        serviceId: original.serviceId,
        clientId: original.clientId,
        channel: original.channel,
        timeRange: original.timeRange,
        searchWindow: { start: at('2026-09-01', '09:00'), end: at('2026-09-01', '18:00') },
      });
    }

    // THEN: all offers should have origin_occupancy_id matching the original hold id
    expect(offerIds).toHaveLength(1);
    expect(offerIds[0]).toBe('original-1');
  });
});