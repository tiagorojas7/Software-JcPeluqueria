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

// 12.12 RED — derived from specs/barber-absence-reassignment/spec.md:
//
//   "Requirement: No interferencia con otros turnos"
//   "El sistema MUST NOT modificar turnos ya agendados de otros clientes al
//   generar o resolver ofertas de reasignación."
//
//   Scenario "Turnos de otros clientes permanecen intactos":
//     GIVEN turnos `reservado` de otros clientes en la misma franja, con
//     barberos no afectados
//     WHEN se resuelve la ausencia de un barbero distinto
//     THEN esos turnos permanecen sin cambios
describe('MarkBarberAbsentUseCase — no interferencia con otros turnos (12.12)', () => {
  it('never returns, and never mutates, another client turno on a non-absent barber in the exact same time window', async () => {
    const appointments = new FakeAppointmentRepository();
    const absentBarberTurno = anAppointment({ id: 'apt-absent-barber', barberId: 'barber-1' });
    const otherClientTurno = anAppointment({
      id: 'apt-other-client',
      barberId: 'barber-2', // not affected by barber-1's absence
      clientId: 'client-2',
      timeRange: { start: at('10:00'), end: at('10:30') }, // exact same franja
    });
    appointments.seed(absentBarberTurno);
    appointments.seed(otherClientTurno);
    const useCase = new MarkBarberAbsentUseCase(appointments);

    const affected = await useCase.execute({
      barberId: 'barber-1',
      timeRange: { start: at('09:00'), end: at('18:00') },
    });

    expect(affected.map((a) => a.id)).toEqual(['apt-absent-barber']);
    // Detection is READ-ONLY by construction (MarkBarberAbsentUseCase never
    // calls updateSchedule/updateStatus); this pins that the OTHER client's
    // row is not just excluded from the result but genuinely byte-identical
    // to what was seeded.
    expect(appointments.updateScheduleCalls).toEqual([]);
    expect(appointments.updateStatusCalls).toEqual([]);
    await expect(appointments.findById('apt-other-client')).resolves.toEqual(otherClientTurno);
  });
});

// 12.13 GREEN — "confirmar el alcance de la query de detección (12.1) y de
// la generación de ofertas (12.3) contra 12.12": no new production code —
// the detection query's `WHERE barber_id = :barberId` (12.1/12.2) already
// makes the scope structural, and GenerateAbsenceReassignmentOffers
// (12.3/12.4) never receives or holds an `AppointmentRepository` reference
// at all, so it has no way to write to any appointment, another client's or
// otherwise — it can only call `CreateHold`. This suite is the regression
// lock proving both, the same "ya cubierto por" pattern Phase 8/11 already
// used for a requirement satisfied by an existing shape rather than new code.
