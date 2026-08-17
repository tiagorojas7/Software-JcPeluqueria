import { FakeAppointmentRepository, FakeClock, type Appointment } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { MarkBarberAbsentUseCase } from './mark-barber-absent';

const clock = new FakeClock();
const at = (time: string) => clock.localTimeToUtc('2026-09-01', time);

const anAppointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'appointment-1',
  barberId: 'barber-1',
  serviceId: 'service-1',
  clientId: 'client-1',
  channel: 'web',
  timeRange: { start: at('10:00'), end: at('10:30') },
  status: 'reservado',
  deposit: { kind: 'not_applicable' },
  ...overrides,
});

// 12.1 RED — derived from specs/barber-absence-reassignment/spec.md:
//
//   "Requirement: Detección de turnos afectados"
//   "Cuando el personal autorizado marca a un barbero como no disponible
//   para una franja horaria, el sistema MUST identificar todos los turnos
//   en `reservado` de ese barbero dentro de esa franja."
//
//   Scenario "Ausencia marcada detecta turnos afectados":
//     GIVEN un barbero con turnos `reservado` dentro de una franja
//     WHEN el personal autorizado lo marca no disponible para esa franja
//     THEN el sistema identifica esos turnos como afectados
describe('MarkBarberAbsentUseCase', () => {
  it('identifies every reservado appointment of the absent barber inside the marked range', async () => {
    const appointments = new FakeAppointmentRepository();
    const affectedOne = anAppointment({ id: 'apt-1', timeRange: { start: at('10:00'), end: at('10:30') } });
    const affectedTwo = anAppointment({ id: 'apt-2', timeRange: { start: at('14:00'), end: at('14:30') } });
    appointments.seed(affectedOne);
    appointments.seed(affectedTwo);
    const useCase = new MarkBarberAbsentUseCase(appointments);

    const affected = await useCase.execute({
      barberId: 'barber-1',
      timeRange: { start: at('09:00'), end: at('18:00') },
    });

    expect(affected.map((a) => a.id).sort()).toEqual(['apt-1', 'apt-2']);
  });

  it('returns an empty list when the barber has no reservado appointments in the range', async () => {
    const appointments = new FakeAppointmentRepository();
    const useCase = new MarkBarberAbsentUseCase(appointments);

    const affected = await useCase.execute({
      barberId: 'barber-1',
      timeRange: { start: at('09:00'), end: at('18:00') },
    });

    expect(affected).toEqual([]);
  });

  // Delegates the ENTIRE scoping decision to AppointmentRepository — this
  // use case takes no Appointment[] array and does no filtering of its own,
  // exactly the port-not-array shape the prior rejected WIP got wrong.
  it('delegates the range/barber scoping to the repository, never re-filtering client-side', async () => {
    const appointments = new FakeAppointmentRepository();
    const outsideRange = anAppointment({ id: 'apt-out', timeRange: { start: at('20:00'), end: at('20:30') } });
    const otherBarber = anAppointment({ id: 'apt-other-barber', barberId: 'barber-2' });
    appointments.seed(outsideRange);
    appointments.seed(otherBarber);
    const useCase = new MarkBarberAbsentUseCase(appointments);

    const affected = await useCase.execute({
      barberId: 'barber-1',
      timeRange: { start: at('09:00'), end: at('18:00') },
    });

    expect(affected).toEqual([]);
  });
});
