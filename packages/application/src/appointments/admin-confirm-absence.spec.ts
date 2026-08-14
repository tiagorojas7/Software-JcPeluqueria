import {
  AppointmentNotFoundError,
  FakeAbsenceRecordRepository,
  FakeAppointmentRepository,
  FakeClock,
  MissingActorError,
  type ActorContext,
  type Appointment,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { AdminConfirmAbsenceUseCase } from './admin-confirm-absence';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);
const NOW = dateBuilder.localTimeToUtc('2026-09-02', '12:00');

const STAFF_ACTOR: ActorContext = { userId: 'staff-1', role: 'secretary' };

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'telefonico',
    timeRange: { start: at('10:00'), end: at('10:30') },
    status: 'sin_registrado',
    deposit: { kind: 'not_applicable' },
    ...overrides,
  };
}

describe('AdminConfirmAbsenceUseCase (10.10/10.11) — resolver sin_registrar como ausente', () => {
  it('confirms an absence with a settled seña — forfeits the seña, persists ausente and the absence record', async () => {
    // admin-operations spec, "Resolución de un turno sin registrar como
    // ausente, con seña": pasa a ausente AND la seña queda perdida.
    const appointments = new FakeAppointmentRepository();
    const absences = new FakeAbsenceRecordRepository();
    appointments.seed(
      buildAppointment({
        channel: 'web',
        deposit: { kind: 'settled', paymentId: 'pay-1', amountCents: 500_000 },
      }),
    );
    const useCase = new AdminConfirmAbsenceUseCase(
      appointments,
      absences,
      new FakeClock(-180, NOW),
    );

    const result = await useCase.execute('appt-1', STAFF_ACTOR);

    expect(result.appointment.status).toBe('ausente');
    expect(result.appointment.deposit).toEqual({ kind: 'forfeited', amountCents: 500_000 });
    expect(appointments.updateStatusCalls).toEqual([{ id: 'appt-1', status: 'ausente' }]);
    expect(absences.recordCalls).toEqual([
      {
        appointmentId: 'appt-1',
        clientId: 'client-1',
        confirmedByUserId: 'staff-1',
        confirmedAt: NOW,
        depositForfeited: true,
      },
    ]);
  });

  it('confirms an absence with no seña — no money movement, but still records the absence in history', async () => {
    // admin-operations spec, "Resolución de un turno sin registrar como
    // ausente, sin seña": no se ejecuta ningún movimiento de dinero, pero el
    // evento queda registrado en el historial de ausencias del cliente.
    const appointments = new FakeAppointmentRepository();
    const absences = new FakeAbsenceRecordRepository();
    appointments.seed(buildAppointment({ deposit: { kind: 'not_applicable' } }));
    const useCase = new AdminConfirmAbsenceUseCase(
      appointments,
      absences,
      new FakeClock(-180, NOW),
    );

    const result = await useCase.execute('appt-1', STAFF_ACTOR);

    expect(result.appointment.status).toBe('ausente');
    expect(result.appointment.deposit).toEqual({ kind: 'not_applicable' });
    expect(absences.recordCalls).toHaveLength(1);
    expect(absences.recordCalls[0]?.depositForfeited).toBe(false);
  });

  it('resolves an absence regardless of which barber the appointment belongs to — no barber restriction', async () => {
    // admin-operations spec: any staff resolves any sin_registrar; the
    // barberId narrowing for barbers is Phase 11 (task 11.13) only.
    const appointments = new FakeAppointmentRepository();
    const absences = new FakeAbsenceRecordRepository();
    appointments.seed(buildAppointment({ barberId: 'some-other-barber' }));
    const useCase = new AdminConfirmAbsenceUseCase(
      appointments,
      absences,
      new FakeClock(-180, NOW),
    );

    const result = await useCase.execute('appt-1', STAFF_ACTOR);

    expect(result.appointment.status).toBe('ausente');
  });

  it('rejects confirming an absence without a real human actor', async () => {
    // appointment-lifecycle spec, "El sistema nunca marca ausencias por su
    // cuenta": only an explicit human confirmation may reach ausente.
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment());
    const useCase = new AdminConfirmAbsenceUseCase(
      appointments,
      new FakeAbsenceRecordRepository(),
      new FakeClock(-180, NOW),
    );
    const noActor = undefined as unknown as ActorContext;

    await expect(useCase.execute('appt-1', noActor)).rejects.toBeInstanceOf(MissingActorError);
  });

  it('rejects confirming an absence for an appointment id that does not exist', async () => {
    const appointments = new FakeAppointmentRepository();
    const useCase = new AdminConfirmAbsenceUseCase(
      appointments,
      new FakeAbsenceRecordRepository(),
      new FakeClock(-180, NOW),
    );

    await expect(useCase.execute('missing', STAFF_ACTOR)).rejects.toBeInstanceOf(
      AppointmentNotFoundError,
    );
  });
});
