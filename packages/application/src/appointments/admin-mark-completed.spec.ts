import {
  AppointmentNotFoundError,
  AppointmentNotStartedError,
  FakeAppointmentRepository,
  FakeClock,
  InvalidAppointmentTransitionError,
  type Appointment,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { AdminMarkCompletedUseCase } from './admin-mark-completed';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);
/** 10:15 shop time on the appointment's own day — after it started. */
const NOW = at('10:15');

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'telefonico',
    timeRange: { start: at('10:00'), end: at('10:30') },
    status: 'reservado',
    deposit: { kind: 'not_applicable' },
    ...overrides,
  };
}

function buildUseCase(appointments: FakeAppointmentRepository, now: Date = NOW): AdminMarkCompletedUseCase {
  return new AdminMarkCompletedUseCase(appointments, new FakeClock(-180, now));
}

describe('AdminMarkCompletedUseCase (10.9/10.11) — marcar realizado sin restricción de barbero', () => {
  it('marks a reservado phone appointment realizado with no money movement', async () => {
    // appointment-lifecycle spec, "Turno realizado sin seña previa": GIVEN
    // un turno telefónico en reservado sin seña, WHEN the personal autorizado
    // lo marca realizado, THEN pasa a realizado AND no cobro ni reembolso.
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment());
    const useCase = buildUseCase(appointments);

    const result = await useCase.execute('appt-1');

    expect(result.status).toBe('realizado');
    expect(result.deposit).toEqual({ kind: 'not_applicable' });
    expect(appointments.updateStatusCalls).toEqual([{ id: 'appt-1', status: 'realizado' }]);
  });

  it('also resolves a sin_registrado appointment as realizado (next-day resolution from the panel)', async () => {
    // admin-operations spec, "Marcado de realizados y resolución de
    // pendientes": the panel resolves turnos en sin registrar to realizado.
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment({ status: 'sin_registrado' }));
    const useCase = buildUseCase(appointments);

    const result = await useCase.execute('appt-1');

    expect(result.status).toBe('realizado');
    expect(appointments.updateStatusCalls).toEqual([{ id: 'appt-1', status: 'realizado' }]);
  });

  it('marks realizado regardless of which barber the appointment belongs to — no barber restriction', async () => {
    // admin-operations spec: "marcar realizado cualquier turno,
    // independientemente del barbero asignado". Phase 10 connects the panel
    // WITHOUT the barberId guard Phase 11 (task 11.13) adds for barbers; the
    // absence of any actor/barberId parameter here is the proof of intent.
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment({ barberId: 'some-other-barber' }));
    const useCase = buildUseCase(appointments);

    const result = await useCase.execute('appt-1');

    expect(result.status).toBe('realizado');
  });

  it('rejects marking an appointment that is already terminal (realizado)', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment({ status: 'realizado' }));
    const useCase = buildUseCase(appointments);

    await expect(useCase.execute('appt-1')).rejects.toBeInstanceOf(
      InvalidAppointmentTransitionError,
    );
  });

  // Bug real de producción (turno a38c86ae): un walk-in sin cliente
  // identificado (`clientId: null`) es un `Appointment` válido — sólo
  // `AppointmentRepository.findById` lo negaba (infra bug). Esto prueba que,
  // una vez encontrado, el caso de uso lo marca realizado sin depender del
  // cliente para nada.
  it('marks realizado a turno con clientId null — el cliente no identificado no es motivo para negarlo', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment({ clientId: null }));
    const useCase = buildUseCase(appointments);

    const result = await useCase.execute('appt-1');

    expect(result.status).toBe('realizado');
    expect(result.clientId).toBeNull();
  });

  it('rejects marking an appointment id that does not exist', async () => {
    const appointments = new FakeAppointmentRepository();
    const useCase = buildUseCase(appointments);

    await expect(useCase.execute('missing')).rejects.toBeInstanceOf(AppointmentNotFoundError);
  });

  it('rejects marking realizado a turno cuya hora de inicio todavía no llegó — bug real de producción', async () => {
    // Real production data: a reservado turno dated 2026-09-03 13:30 was
    // found marked realizado while now was still 2026-08-31.
    const appointments = new FakeAppointmentRepository();
    appointments.seed(
      buildAppointment({
        timeRange: { start: dateBuilder.localTimeToUtc('2026-09-03', '13:30'), end: dateBuilder.localTimeToUtc('2026-09-03', '14:00') },
      }),
    );
    const useCase = buildUseCase(appointments);

    await expect(useCase.execute('appt-1')).rejects.toBeInstanceOf(AppointmentNotStartedError);
    expect(appointments.updateStatusCalls).toEqual([]);
  });
});
