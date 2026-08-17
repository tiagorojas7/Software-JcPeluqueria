import {
  createBarberSchedule,
  createService,
  createShopHours,
  FakeBarberRepository,
  FakeClientRepository,
  FakeClock,
  FakeFreeRangesQuery,
  FakeScheduleRepository,
  FakeServiceRepository,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { GetPublicAvailabilityUseCase } from '../availability/get-public-availability';
import { ManageClientsAndBarbersUseCase } from './manage-clients-and-barbers';

// 10.14 RED — derived from specs/admin-operations/spec.md, not from an
// implementation:
//
//   "Gestión de clientes y de barberos":
//     El sistema MUST poder ver y administrar los registros de clientes. El
//     alta y baja de barberos, y la configuración de horarios base y
//     precios de servicios, MUST quedar restringidas a los roles
//     autorizados según access-control.
//
//   Scenario "Alta de un nuevo barbero":
//     GIVEN un rol autorizado para configuración
//     WHEN da de alta un nuevo barbero con su horario base
//     THEN el barbero queda disponible para asignación de turnos
//
// The prior WIP on `feat/turnero-10c-panel-cierre` (rejected) was a
// `DrizzleBarberUseCase`/`DrizzleClientUseCase` pair that lied about what it
// was (naming a Drizzle detail into an application-layer class, which
// imports NOTHING infrastructure-specific per the hexagonal rule), did
// nothing but list+create with zero tests, and declared `NotFoundError`
// types it never threw. This suite proves the "queda disponible" clause
// literally — not by asserting a returned flag, but by feeding the exact
// barber/schedule this use case wrote into `GetPublicAvailabilityUseCase`
// (already tested, 9.1/9.2) and checking it actually produces bookable
// slots. A barber created `active` but with no schedule row, or with a row
// nobody reads, would fail this test even though a shallow "was `create`
// called" assertion would still pass — that gap is exactly what sank the
// rejected version's sibling `barber-revenue.ts` (label text that never
// matched the requirement).

const clock = new FakeClock();
const at = (time: string) => clock.localTimeToUtc('2026-09-07', time); // a Monday

function buildUseCase() {
  const clients = new FakeClientRepository();
  const barbers = new FakeBarberRepository();
  const schedules = new FakeScheduleRepository();
  const services = new FakeServiceRepository();
  const useCase = new ManageClientsAndBarbersUseCase(clients, barbers, schedules, services);
  return { useCase, clients, barbers, schedules, services };
}

describe('ManageClientsAndBarbersUseCase (10.14/10.15)', () => {
  it('adding a barber with a base schedule makes them genuinely assignable — bookable slots appear', async () => {
    const { useCase, barbers, schedules, services } = buildUseCase();
    await services.create(
      createService({ id: 'service-1', name: 'Corte clasico', durationMinutes: 30, priceCents: 500000 }),
    );
    await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }));

    const barber = await useCase.addBarber({
      id: 'barber-1',
      name: 'Nuevo Barbero',
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }],
    });

    expect(barber).toMatchObject({ id: 'barber-1', name: 'Nuevo Barbero', active: true });

    // The literal "queda disponible para asignación de turnos" check: reuse
    // the already-tested public availability use case, unmodified, against
    // the exact rows `addBarber` just wrote.
    const freeRangesQuery = new FakeFreeRangesQuery();
    freeRangesQuery.seed('barber-1', [{ start: at('09:00'), end: at('13:00') }]);
    const availability = new GetPublicAvailabilityUseCase(barbers, services, schedules, freeRangesQuery, clock);

    const result = await availability.execute({
      barberId: 'barber-1',
      serviceId: 'service-1',
      date: '2026-09-07',
    });

    expect(result.slots.length).toBeGreaterThan(0);
  });

  it('a barber added with no schedule row never becomes assignable — the base schedule is not optional', async () => {
    const { useCase, barbers, schedules, services } = buildUseCase();
    await services.create(
      createService({ id: 'service-1', name: 'Corte clasico', durationMinutes: 30, priceCents: 500000 }),
    );
    await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }));

    await useCase.addBarber({ id: 'barber-2', name: 'Sin Horario', schedule: [] });

    const freeRangesQuery = new FakeFreeRangesQuery();
    freeRangesQuery.seed('barber-2', [{ start: at('09:00'), end: at('13:00') }]);
    const availability = new GetPublicAvailabilityUseCase(barbers, services, schedules, freeRangesQuery, clock);

    const result = await availability.execute({
      barberId: 'barber-2',
      serviceId: 'service-1',
      date: '2026-09-07',
    });

    expect(result.slots).toEqual([]);
  });

  it("lets an authorized role view every client's record", async () => {
    const { useCase, clients } = buildUseCase();
    await clients.create({ name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: null });
    await clients.create({ name: 'Laura', phone: '3517654321', email: null, age: null });

    const listed = await useCase.listClients();

    expect(listed).toHaveLength(2);
    expect(listed.map((c) => c.phone).sort()).toEqual(['3511234567', '3517654321']);
  });

  it('deactivating a barber removes them from assignment — the same availability check flips to empty', async () => {
    const { useCase, barbers, schedules, services } = buildUseCase();
    await services.create(
      createService({ id: 'service-1', name: 'Corte clasico', durationMinutes: 30, priceCents: 500000 }),
    );
    await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }));
    await useCase.addBarber({
      id: 'barber-3',
      name: 'Para Dar de Baja',
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }],
    });

    const result = await useCase.deactivateBarber('barber-3');

    expect(result).toBe(true);
    const freeRangesQuery = new FakeFreeRangesQuery();
    freeRangesQuery.seed('barber-3', [{ start: at('09:00'), end: at('13:00') }]);
    const availability = new GetPublicAvailabilityUseCase(barbers, services, schedules, freeRangesQuery, clock);
    const availabilityResult = await availability.execute({
      barberId: 'barber-3',
      serviceId: 'service-1',
      date: '2026-09-07',
    });
    expect(availabilityResult.slots).toEqual([]);
  });

  it('deactivating an unknown barber id reports false — no exception for a routine "already gone"', async () => {
    const { useCase } = buildUseCase();

    const result = await useCase.deactivateBarber('does-not-exist');

    expect(result).toBe(false);
  });

  it('configures a service price for a real id and reports false for an unknown one', async () => {
    const { useCase, services } = buildUseCase();
    await services.create(
      createService({ id: 'service-1', name: 'Corte clasico', durationMinutes: 30, priceCents: 500000 }),
    );

    const updated = await useCase.configureServicePrice('service-1', 550000);
    const missing = await useCase.configureServicePrice('does-not-exist', 550000);

    expect(updated).toBe(true);
    expect(missing).toBe(false);
    expect(await services.findById('service-1')).toMatchObject({ priceCents: 550000 });
  });

  it('configures the base schedule for a day already on file, and creates it when the day is new', async () => {
    const { useCase, schedules } = buildUseCase();
    await useCase.addBarber({
      id: 'barber-4',
      name: 'Con Horario',
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }],
    });

    await useCase.configureBarberSchedule(
      createBarberSchedule({ barberId: 'barber-4', dayOfWeek: 1, opensAt: '10:00', closesAt: '18:00' }),
    );
    await useCase.configureBarberSchedule(
      createBarberSchedule({ barberId: 'barber-4', dayOfWeek: 2, opensAt: '10:00', closesAt: '18:00' }),
    );

    const own = await schedules.listBarberSchedule('barber-4');
    expect(own).toEqual(
      expect.arrayContaining([
        createBarberSchedule({ barberId: 'barber-4', dayOfWeek: 1, opensAt: '10:00', closesAt: '18:00' }),
        createBarberSchedule({ barberId: 'barber-4', dayOfWeek: 2, opensAt: '10:00', closesAt: '18:00' }),
      ]),
    );
    expect(own).toHaveLength(2); // day 1 was replaced in place, never duplicated
  });
});
