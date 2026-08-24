import {
  createService,
  FakeClientRepository,
  FakeClock,
  FakeServiceRepository,
  FakeWalkInRepository,
  type TimeWindow,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { CreateWalkInUseCase, WalkInServiceNotFoundError } from './create-walk-in';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);
const range = (from: string, to: string): TimeWindow => ({ start: at(from), end: at(to) });
const SEARCH_WINDOW = range('09:00', '18:00');

const SERVICE_ID = 'service-1';
const SERVICE_DURATION_MINUTES = 30;

function buildUseCase() {
  const walkIns = new FakeWalkInRepository();
  const clients = new FakeClientRepository();
  const services = new FakeServiceRepository();
  services.create(
    createService({ id: SERVICE_ID, name: 'Corte clasico', durationMinutes: SERVICE_DURATION_MINUTES, priceCents: 500000 }),
  );
  const clock = new FakeClock();
  const useCase = new CreateWalkInUseCase(walkIns, clients, services, clock);
  return { useCase, walkIns, clients, services, clock };
}

describe('CreateWalkInUseCase (10.12/10.13) — walk-in entra directamente como realizado', () => {
  it('creates a walk-in directly in realizado, no seña, occupying the barber slot, deriving endTime from the service', async () => {
    // appointment-lifecycle spec, "Los walk-ins ingresan directamente como
    // realizado": se crea directamente en realizado, sin seña. admin-operations
    // spec, "Carga de walk-ins": el turno se crea en realizado, sin seña.
    const { useCase, walkIns } = buildUseCase();

    const result = await useCase.execute({
      id: 'walkin-1',
      barberId: 'barber-1',
      serviceId: SERVICE_ID,
      startsAt: at('10:00'),
      searchWindow: SEARCH_WINDOW,
    });

    expect(result).toEqual({
      id: 'walkin-1',
      barberId: 'barber-1',
      serviceId: SERVICE_ID,
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
          serviceId: SERVICE_ID,
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
    const { useCase, walkIns } = buildUseCase();

    const result = await useCase.execute({
      id: 'walkin-2',
      barberId: 'barber-1',
      serviceId: SERVICE_ID,
      startsAt: at('11:00'),
      searchWindow: SEARCH_WINDOW,
    });

    expect(result.status).toBe('realizado');
    expect(result.deposit).toEqual({ kind: 'not_applicable' });
    expect(walkIns.createCalls).toHaveLength(1);
  });

  it('links the walk-in to an existing client found by phone', async () => {
    const { useCase, walkIns, clients } = buildUseCase();
    clients.seed({ id: 'client-7', name: 'Marcos', phone: '3511234567', email: null, age: null });

    const result = await useCase.execute({
      id: 'walkin-3',
      barberId: 'barber-1',
      serviceId: SERVICE_ID,
      clientPhone: '3511234567',
      startsAt: at('12:00'),
      searchWindow: SEARCH_WINDOW,
    });

    expect(result.clientId).toBe('client-7');
    expect(walkIns.createCalls[0]?.occupancy.clientId).toBe('client-7');
  });

  it('stays anonymous when the phone does not match any known client — never fabricates a client record', async () => {
    const { useCase, walkIns } = buildUseCase();

    const result = await useCase.execute({
      id: 'walkin-4',
      barberId: 'barber-1',
      serviceId: SERVICE_ID,
      clientPhone: '3519999999',
      startsAt: at('13:00'),
      searchWindow: SEARCH_WINDOW,
    });

    expect(result.clientId).toBeNull();
    expect(walkIns.createCalls[0]?.occupancy.clientId).toBeNull();
  });

  it('rejects a walk-in into a service that does not exist, before writing anything', async () => {
    const { useCase, walkIns } = buildUseCase();

    await expect(
      useCase.execute({
        id: 'walkin-5',
        barberId: 'barber-1',
        serviceId: 'no-such-service',
        startsAt: at('14:00'),
        searchWindow: SEARCH_WINDOW,
      }),
    ).rejects.toBeInstanceOf(WalkInServiceNotFoundError);
    expect(walkIns.createCalls).toHaveLength(0);
  });
});
