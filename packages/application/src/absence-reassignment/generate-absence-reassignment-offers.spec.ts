import {
  createBarber,
  createBarberSchedule,
  createService,
  createShopHours,
  FakeBarberRepository,
  FakeClock,
  FakeFreeRangesQuery,
  FakeHoldExpireScheduler,
  FakeHoldRepository,
  FakeScheduleRepository,
  FakeServiceRepository,
  type Appointment,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { CreateHold } from '../booking/create-hold';
import { GenerateAbsenceReassignmentOffers } from './generate-absence-reassignment-offers';

// A throwaway FakeClock used only to build fixed instants for test data —
// never the one injected into the use case itself (create-hold.spec.ts's
// same pattern).
const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-07', time); // a Monday
const clock = new FakeClock(-180, at('09:45'));

const anAppointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'appointment-1',
  barberId: 'barber-absent',
  serviceId: 'service-1',
  clientId: 'client-1',
  channel: 'web',
  timeRange: { start: at('10:00'), end: at('10:30') },
  status: 'reservado',
  deposit: { kind: 'not_applicable' },
  ...overrides,
});

async function buildScenario() {
  const barbers = new FakeBarberRepository();
  const services = new FakeServiceRepository();
  const schedules = new FakeScheduleRepository();
  const freeRanges = new FakeFreeRangesQuery();
  const holds = new FakeHoldRepository();
  const createHold = new CreateHold(holds, clock, new FakeHoldExpireScheduler());

  await barbers.create(createBarber({ id: 'barber-absent', name: 'Ausente', active: true }));
  await barbers.create(createBarber({ id: 'barber-other', name: 'Disponible', active: true }));
  await services.create(createService({ id: 'service-1', name: 'Corte', durationMinutes: 30, priceCents: 500000 }));
  await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }));
  await schedules.createBarberSchedule(
    createBarberSchedule({ barberId: 'barber-absent', dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }),
  );
  await schedules.createBarberSchedule(
    createBarberSchedule({ barberId: 'barber-other', dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }),
  );

  const useCase = new GenerateAbsenceReassignmentOffers(barbers, services, schedules, freeRanges, createHold, clock);

  return { useCase, barbers, services, schedules, freeRanges, holds };
}

// 12.3 RED — derived from specs/barber-absence-reassignment/spec.md:
//
//   "Requirement: Ofertas del mismo día, de cualquier barbero"
//   "Para cada turno afectado, el sistema MUST buscar horarios libres del
//   mismo día calendario del turno original, entre cualquier barbero
//   disponible y no solo el ausente, MUST crear un hold de 15 minutos ...
//   sobre cada horario ofrecido"
//
//   Scenario "Oferta incluye barberos distintos del ausente":
//     GIVEN un turno afectado por la ausencia del barbero A
//     WHEN el sistema genera las ofertas
//     THEN incluye horarios libres de otros barberos además de, o en lugar
//     de, el barbero A
//     AND cada horario ofrecido queda protegido por un hold de 15 minutos
describe('GenerateAbsenceReassignmentOffers', () => {
  it('offers a same-day slot from a DIFFERENT barber, protected by a 15-minute hold with origin_occupancy_id set', async () => {
    const { useCase, freeRanges, holds } = await buildScenario();
    const affected = anAppointment();
    // The absent barber has nothing free that day at all — the only route to
    // a real offer is querying OTHER barbers too, not just barber-absent.
    freeRanges.seed('barber-absent', []);
    freeRanges.seed('barber-other', [{ start: at('11:00'), end: at('11:30') }]);

    const results = await useCase.execute([affected]);

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('offered');
    expect(holds.createCalls).toHaveLength(1);
    const created = holds.createCalls[0]!.hold;
    expect(created.barberId).toBe('barber-other');
    expect(created.timeRange).toEqual({ start: at('11:00'), end: at('11:30') });
    expect(created.holdExpiresAt).toEqual(clock.addMinutes(clock.now(), 15));
    expect(created.originOccupancyId).toBe(affected.id);
    expect(created.clientId).toBe('client-1');
    expect(created.serviceId).toBe('service-1');
  });

  // 12.3 RED continued — same requirement, "mismo día calendario del turno
  // original": a free slot on a LATER calendar day must never be offered,
  // even when it is the only thing free anywhere.
  it('never offers a slot on a different calendar day than the original appointment', async () => {
    const { useCase, schedules, freeRanges } = await buildScenario();
    await schedules.createShopHours(createShopHours({ dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' }));
    await schedules.createBarberSchedule(
      createBarberSchedule({ barberId: 'barber-other', dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' }),
    );
    const affected = anAppointment();
    freeRanges.seed('barber-absent', []);
    freeRanges.seed('barber-other', []); // nothing free the SAME day

    const results = await useCase.execute([affected]);

    expect(results).toEqual([{ originalAppointmentId: affected.id, outcome: 'no-availability', hold: null }]);
  });
});
