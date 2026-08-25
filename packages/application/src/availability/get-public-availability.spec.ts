import {
  FakeBarberRepository,
  FakeClock,
  FakeFreeRangesQuery,
  FakeScheduleRepository,
  FakeServiceRepository,
  createBarber,
  createBarberSchedule,
  createService,
  createShopHours,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { GetPublicAvailabilityUseCase } from './get-public-availability';

// 9.1 RED — derived from specs/client-booking/spec.md, not from an
// implementation:
//
//   "Exploración sin cuenta": the system MUST let any visitor consult
//   available services, barbers and schedules WITHOUT creating an account or
//   authenticating.
//
//   Scenario "Consulta de disponibilidad anónima":
//     GIVEN a visitor with no account in the system
//     WHEN they consult the available schedules for a service
//     THEN the system shows the free schedules without asking for registration
//
// This use case takes no actor/session at all — there is nothing to
// authenticate, by construction: an anonymous visitor is the only caller.

// A throwaway FakeClock used only to build fixed instants for test data — the
// use case itself always gets a clock with a real `now`, because "which start
// times are still bookable" is part of what it answers.
const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-07', time); // a Monday

// Default: the shop day has not started yet, so nothing is filtered out by the
// elapsed-slot rule and each test states only the behaviour it is about.
function buildUseCase(now: Date = at('00:00')) {
  const barbers = new FakeBarberRepository();
  const services = new FakeServiceRepository();
  const schedules = new FakeScheduleRepository();
  const freeRanges = new FakeFreeRangesQuery();
  const clock = new FakeClock(-180, now);
  const useCase = new GetPublicAvailabilityUseCase(barbers, services, schedules, freeRanges, clock);
  return { useCase, barbers, services, schedules, freeRanges };
}

describe('GetPublicAvailabilityUseCase', () => {
  it('returns bookable slots for the service duration, computed from working hours minus occupancy — no account involved', async () => {
    const { useCase, barbers, services, schedules, freeRanges } = buildUseCase();
    await barbers.create(createBarber({ id: 'barber-1', name: 'Juan', active: true }));
    await services.create(createService({ id: 'service-1', name: 'Corte', durationMinutes: 30, priceCents: 500000 }));
    await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }));
    await schedules.createBarberSchedule(
      createBarberSchedule({ barberId: 'barber-1', dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }),
    );
    // Occupancy already subtracts a held/reservado range — the use case must
    // never re-derive this itself, only forward the working window to
    // `FreeRangesQuery` and slice what comes back.
    freeRanges.seed('barber-1', [{ start: at('09:00'), end: at('10:00') }]);

    const result = await useCase.execute({ barberId: 'barber-1', serviceId: 'service-1', date: '2026-09-07' });

    expect(result.slots).toEqual([
      { start: at('09:00'), end: at('09:30') },
      { start: at('09:30'), end: at('10:00') },
    ]);
    // The working window queried for occupancy is the barber's real working
    // window for the day, not an arbitrary guess.
    expect(freeRanges.calls).toEqual([
      { barberId: 'barber-1', searchWindow: { start: at('09:00'), end: at('13:00') } },
    ]);
  });

  it('returns no slots, without error, when the barber does not work that day of week', async () => {
    const { useCase, barbers, services, schedules } = buildUseCase();
    await barbers.create(createBarber({ id: 'barber-1', name: 'Juan', active: true }));
    await services.create(createService({ id: 'service-1', name: 'Corte', durationMinutes: 30, priceCents: 500000 }));
    await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }));
    // No BarberSchedule row for Monday.

    const result = await useCase.execute({ barberId: 'barber-1', serviceId: 'service-1', date: '2026-09-07' });

    expect(result.slots).toEqual([]);
  });

  // RED — the reported bug: browsing today's availability at 10:30 still
  // offered 09:00 and 10:00. Occupancy does not remove them (nobody booked
  // them, they simply went by), so the only thing that can is the clock.
  it('never offers a start time that already went by when the requested date is today', async () => {
    const { useCase, barbers, services, schedules, freeRanges } = buildUseCase(at('10:05'));
    await barbers.create(createBarber({ id: 'barber-1', name: 'Juan', active: true }));
    await services.create(createService({ id: 'service-1', name: 'Corte', durationMinutes: 30, priceCents: 500000 }));
    await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }));
    await schedules.createBarberSchedule(
      createBarberSchedule({ barberId: 'barber-1', dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }),
    );
    freeRanges.seed('barber-1', [{ start: at('09:00'), end: at('11:00') }]);

    const result = await useCase.execute({ barberId: 'barber-1', serviceId: 'service-1', date: '2026-09-07' });

    expect(result.slots).toEqual([{ start: at('10:30'), end: at('11:00') }]);
  });

  it('returns no slots for a date the shop already left behind', async () => {
    const { useCase, barbers, services, schedules, freeRanges } = buildUseCase(
      dateBuilder.localTimeToUtc('2026-09-14', '09:00'),
    );
    await barbers.create(createBarber({ id: 'barber-1', name: 'Juan', active: true }));
    await services.create(createService({ id: 'service-1', name: 'Corte', durationMinutes: 30, priceCents: 500000 }));
    await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }));
    await schedules.createBarberSchedule(
      createBarberSchedule({ barberId: 'barber-1', dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }),
    );
    freeRanges.seed('barber-1', [{ start: at('09:00'), end: at('13:00') }]);

    const result = await useCase.execute({ barberId: 'barber-1', serviceId: 'service-1', date: '2026-09-07' });

    expect(result.slots).toEqual([]);
  });

  it('returns no slots for a service id that does not exist, instead of throwing', async () => {
    const { useCase } = buildUseCase();

    const result = await useCase.execute({ barberId: 'barber-1', serviceId: 'no-existe', date: '2026-09-07' });

    expect(result.slots).toEqual([]);
  });

  it('returns no slots for a barber id that does not exist, instead of throwing', async () => {
    const { useCase, services } = buildUseCase();
    await services.create(createService({ id: 'service-1', name: 'Corte', durationMinutes: 30, priceCents: 500000 }));

    const result = await useCase.execute({ barberId: 'no-existe', serviceId: 'service-1', date: '2026-09-07' });

    expect(result.slots).toEqual([]);
  });

  it('returns no slots for an inactive barber — never offered for new bookings', async () => {
    const { useCase, barbers, services, schedules, freeRanges } = buildUseCase();
    await barbers.create(createBarber({ id: 'barber-1', name: 'Juan', active: false }));
    await services.create(createService({ id: 'service-1', name: 'Corte', durationMinutes: 30, priceCents: 500000 }));
    await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }));
    await schedules.createBarberSchedule(
      createBarberSchedule({ barberId: 'barber-1', dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }),
    );
    freeRanges.seed('barber-1', [{ start: at('09:00'), end: at('10:00') }]);

    const result = await useCase.execute({ barberId: 'barber-1', serviceId: 'service-1', date: '2026-09-07' });

    expect(result.slots).toEqual([]);
  });
});
