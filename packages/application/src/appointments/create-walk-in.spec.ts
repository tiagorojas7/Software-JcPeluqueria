import {
  FakeWalkInRepository,
  FakeClock,
  type TimeWindow,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { CreateWalkInUseCase } from './create-walk-in';

const dateBuilder = new FakeClock();
const range = (from: string, to: string): TimeWindow => ({
  start: dateBuilder.localTimeToUtc('2026-09-01', from),
  end: dateBuilder.localTimeToUtc('2026-09-01', to),
});
const SEARCH_WINDOW = range('09:00', '18:00');

describe('CreateWalkInUseCase (10.12/10.13) — walk-in entra directamente como realizado', () => {
  it('creates a walk-in directly in realizado, no seña, occupying the barber slot', async () => {
    // appointment-lifecycle spec, "Los walk-ins ingresan directamente como
    // realizado": se crea directamente en realizado, sin seña. admin-operations
    // spec, "Carga de walk-ins": el turno se crea en realizado, sin seña.
    const walkIns = new FakeWalkInRepository();
    const useCase = new CreateWalkInUseCase(walkIns);

    const result = await useCase.execute({
      id: 'walkin-1',
      barberId: 'barber-1',
      serviceId: 'service-1',
      clientId: null,
      timeRange: range('10:00', '10:30'),
      searchWindow: SEARCH_WINDOW,
    });

    expect(result).toEqual({
      id: 'walkin-1',
      barberId: 'barber-1',
      serviceId: 'service-1',
      clientId: null,
      channel: 'walk_in',
      timeRange: range('10:00', '10:30'),
      status: 'realizado',
      deposit: { kind: 'not_applicable' },
    });
    expect(walkIns.createCalls).toEqual([
      {
        occupancy: {
          id: 'walkin-1',
          barberId: 'barber-1',
          serviceId: 'service-1',
          clientId: null,
          timeRange: range('10:00', '10:30'),
        },
        searchWindow: SEARCH_WINDOW,
      },
    ]);
  });

  it('never goes through reservado and carries no deposit — servicio and barbero are the only required inputs', async () => {
    // admin-operations spec: "indicando obligatoriamente servicio y barbero".
    // No hold, no confirm step, no deposit: realizado is the entry status.
    const walkIns = new FakeWalkInRepository();
    const useCase = new CreateWalkInUseCase(walkIns);

    const result = await useCase.execute({
      id: 'walkin-2',
      barberId: 'barber-1',
      serviceId: 'service-1',
      clientId: null,
      timeRange: range('11:00', '11:30'),
      searchWindow: SEARCH_WINDOW,
    });

    expect(result.status).toBe('realizado');
    expect(result.deposit).toEqual({ kind: 'not_applicable' });
    expect(walkIns.createCalls).toHaveLength(1);
  });

  it('accepts an optional client when the walk-in is linked to a known client', async () => {
    const walkIns = new FakeWalkInRepository();
    const useCase = new CreateWalkInUseCase(walkIns);

    const result = await useCase.execute({
      id: 'walkin-3',
      barberId: 'barber-1',
      serviceId: 'service-1',
      clientId: 'client-7',
      timeRange: range('12:00', '12:30'),
      searchWindow: SEARCH_WINDOW,
    });

    expect(result.clientId).toBe('client-7');
    expect(walkIns.createCalls[0]?.occupancy.clientId).toBe('client-7');
  });
});
