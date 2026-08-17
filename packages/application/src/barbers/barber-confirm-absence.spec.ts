import {
  AppointmentNotFoundError,
  FakeAbsenceRecordRepository,
  FakeAppointmentRepository,
  FakeClock,
  type ActorContext,
  type Appointment,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { BarberConfirmAbsenceUseCase } from './barber-confirm-absence';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);
const NOW = dateBuilder.localTimeToUtc('2026-09-02', '12:00');

const OWN_BARBER_ID = 'barber-own';
const OWN_ACTOR: ActorContext = { userId: 'user-own', role: 'barber', barberId: OWN_BARBER_ID };

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    barberId: OWN_BARBER_ID,
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'web',
    timeRange: { start: at('10:00'), end: at('10:30') },
    status: 'sin_registrado',
    deposit: { kind: 'not_applicable' },
    ...overrides,
  };
}

// barber-profile spec, "Resolución de los turnos propios":
//
//   "[...] MUST poder resolver sus propios turnos en `sin registrar`
//   transicionándolos a `realizado` o a `ausente` [...] exista o no seña
//   asociada. El barbero MUST NOT poder ejecutar ninguna de estas acciones
//   sobre turnos asignados a otro barbero."
//
//   Scenario: Barbero resuelve su propio turno sin registrar como ausente
//     GIVEN un turno propio en `sin registrar` con seña retenida
//     WHEN el barbero confirma que el cliente no vino
//     THEN el turno pasa a `ausente`
//     AND la seña queda perdida
//
//   Scenario: Barbero intenta resolver el turno de un colega
//     GIVEN un turno `reservado` o `sin registrar` asignado a otro barbero
//     WHEN el barbero autenticado intenta resolverlo
//     THEN el sistema MUST rechazar la operación
describe('BarberConfirmAbsenceUseCase (11.11/11.12/11.13)', () => {
  it('confirms an absence on the own sin_registrado appointment — the held seña is forfeited', async () => {
    const appointments = new FakeAppointmentRepository();
    const absences = new FakeAbsenceRecordRepository();
    appointments.seed(
      buildAppointment({ deposit: { kind: 'settled', paymentId: 'pay-1', amountCents: 500_000 } }),
    );
    const useCase = new BarberConfirmAbsenceUseCase(appointments, absences, new FakeClock(-180, NOW));

    const result = await useCase.execute('appt-1', OWN_ACTOR);

    expect(result.outcome).toBe('confirmed');
    if (result.outcome !== 'confirmed') throw new Error('unreachable');
    expect(result.appointment.status).toBe('ausente');
    expect(result.appointment.deposit).toEqual({ kind: 'forfeited', amountCents: 500_000 });
    expect(absences.recordCalls).toHaveLength(1);
  });

  it("rejects resolving a colleague's sin_registrado appointment — MUST rechazar la operación", async () => {
    const appointments = new FakeAppointmentRepository();
    const absences = new FakeAbsenceRecordRepository();
    appointments.seed(buildAppointment({ barberId: 'barber-colleague' }));
    const useCase = new BarberConfirmAbsenceUseCase(appointments, absences, new FakeClock(-180, NOW));

    const result = await useCase.execute('appt-1', OWN_ACTOR);

    expect(result).toEqual({ outcome: 'forbidden' });
    expect(appointments.updateStatusCalls).toEqual([]);
    expect(absences.recordCalls).toEqual([]);
  });

  it('rejects confirming an absence for an appointment id that does not exist', async () => {
    const appointments = new FakeAppointmentRepository();
    const useCase = new BarberConfirmAbsenceUseCase(
      appointments,
      new FakeAbsenceRecordRepository(),
      new FakeClock(-180, NOW),
    );

    await expect(useCase.execute('missing', OWN_ACTOR)).rejects.toBeInstanceOf(AppointmentNotFoundError);
  });
});
