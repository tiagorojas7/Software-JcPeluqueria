import { FakeClock, type Hold } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { MarkBarberAbsentUseCase } from './mark-barber-absent';

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

describe('MarkBarberAbsentUseCase — RED (task 12.1)', () => {
  it('detects all reserved slots of a barber in a time range', async () => {
    const clock = new FakeClock(-180, at('2026-09-01', '10:00'));

    // In-memory fake: these are the barber's reserved slots before marking absent
    const initialSlots: Hold[] = [
      makeHold({ id: 'slot-1', barberId: 'barber-1', timeRange: { start: at('2026-09-01', '10:00'), end: at('2026-09-01', '10:30') } }),
      makeHold({ id: 'slot-2', barberId: 'barber-1', timeRange: { start: at('2026-09-01', '14:00'), end: at('2026-09-01', '14:30') } }),
    ];

    const useCase = new MarkBarberAbsentUseCase(initialSlots, clock);

    const affected = await useCase.execute({
      barberId: 'barber-1',
      timeRange: { start: at('2026-09-01', '09:00'), end: at('2026-09-01', '18:00') },
    });

    expect(affected).toHaveLength(2);
    expect(affected[0].id).toBe('slot-1');
    expect(affected[1].id).toBe('slot-2');
  });

  it('returns empty when barber has no reserved slots in the range', async () => {
    const clock = new FakeClock(-180, at('2026-09-01', '10:00'));

    const initialSlots: Hold[] = [];

    const useCase = new MarkBarberAbsentUseCase(initialSlots, clock);

    const affected = await useCase.execute({
      barberId: 'barber-1',
      timeRange: { start: at('2026-09-01', '09:00'), end: at('2026-09-01', '18:00') },
    });

    expect(affected).toHaveLength(0);
  });

  it('only returns slots within the specified time range', async () => {
    const clock = new FakeClock(-180, at('2026-09-01', '10:00'));

    const initialSlots: Hold[] = [
      makeHold({ id: 'slot-1', barberId: 'barber-1', timeRange: { start: at('2026-09-01', '10:00'), end: at('2026-09-01', '10:30') } }),
      makeHold({ id: 'slot-2', barberId: 'barber-1', timeRange: { start: at('2026-09-01', '14:00'), end: at('2026-09-01', '14:30') } }),
      makeHold({ id: 'slot-3', barberId: 'barber-1', timeRange: { start: at('2026-09-02', '10:00'), end: at('2026-09-02', '10:30') } }),
    ];

    const useCase = new MarkBarberAbsentUseCase(initialSlots, clock);

    const affected = await useCase.execute({
      barberId: 'barber-1',
      timeRange: { start: at('2026-09-01', '09:00'), end: at('2026-09-01', '18:00') },
    });

    expect(affected).toHaveLength(2);
    expect(affected).not.toContainEqual(expect.objectContaining({ id: 'slot-3' }));
  });
});