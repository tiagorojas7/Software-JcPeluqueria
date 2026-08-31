import {
  AppointmentNotFoundError,
  AppointmentNotStartedError,
  FakeAppointmentRepository,
  FakeClock,
  type ActorContext,
  type Appointment,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { BarberMarkCompletedUseCase } from './barber-mark-completed';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);
/** 10:15 shop time on the appointment's own day — after it started. */
const NOW = at('10:15');

const OWN_BARBER_ID = 'barber-own';
const OWN_ACTOR: ActorContext = { userId: 'user-own', role: 'barber', barberId: OWN_BARBER_ID };

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    barberId: OWN_BARBER_ID,
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'telefonico',
    timeRange: { start: at('10:00'), end: at('10:30') },
    status: 'reservado',
    deposit: { kind: 'not_applicable' },
    ...overrides,
  };
}

function buildUseCase(appointments: FakeAppointmentRepository, now: Date = NOW): BarberMarkCompletedUseCase {
  return new BarberMarkCompletedUseCase(appointments, new FakeClock(-180, now));
}

// barber-profile spec, "Resolución de los turnos propios":
//
//   "El barbero MUST poder marcar sus propios turnos `reservado` como
//   `realizado` [...]. El barbero MUST NOT poder ejecutar ninguna de estas
//   acciones sobre turnos asignados a otro barbero."
//
//   Scenario: Barbero marca su propio corte
//     GIVEN un turno propio en `reservado` ya prestado
//     WHEN el barbero lo marca `realizado`
//     THEN el turno pasa a `realizado`
//
//   Scenario: Barbero intenta resolver el turno de un colega
//     GIVEN un turno `reservado` o `sin registrar` asignado a otro barbero
//     WHEN el barbero autenticado intenta resolverlo
//     THEN el sistema MUST rechazar la operación
describe('BarberMarkCompletedUseCase (11.11/11.12/11.13)', () => {
  it('marks the barber\'s own reservado appointment realizado', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment());
    const useCase = buildUseCase(appointments);

    const result = await useCase.execute('appt-1', OWN_ACTOR);

    expect(result).toEqual({ outcome: 'completed', appointment: expect.objectContaining({ status: 'realizado' }) });
    expect(appointments.updateStatusCalls).toEqual([{ id: 'appt-1', status: 'realizado' }]);
  });

  it("rejects marking a colleague's appointment — MUST rechazar la operación", async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment({ barberId: 'barber-colleague' }));
    const useCase = buildUseCase(appointments);

    const result = await useCase.execute('appt-1', OWN_ACTOR);

    expect(result).toEqual({ outcome: 'forbidden' });
    // The rejection must happen before any write — never a partial mutation
    // of a colleague's appointment.
    expect(appointments.updateStatusCalls).toEqual([]);
  });

  it('rejects marking an appointment id that does not exist', async () => {
    const appointments = new FakeAppointmentRepository();
    const useCase = buildUseCase(appointments);

    await expect(useCase.execute('missing', OWN_ACTOR)).rejects.toBeInstanceOf(AppointmentNotFoundError);
  });

  it('rejects marking realizado su propio turno cuando la hora de inicio todavía no llegó', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(
      buildAppointment({
        timeRange: { start: dateBuilder.localTimeToUtc('2026-09-03', '13:30'), end: dateBuilder.localTimeToUtc('2026-09-03', '14:00') },
      }),
    );
    const useCase = buildUseCase(appointments);

    await expect(useCase.execute('appt-1', OWN_ACTOR)).rejects.toBeInstanceOf(AppointmentNotStartedError);
    expect(appointments.updateStatusCalls).toEqual([]);
  });
});
