import {
  AppointmentNotFoundError,
  FakeAppointmentRepository,
  FakeClock,
  type Appointment,
  type TimeWindow,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { EditAppointmentUseCase } from './edit-appointment';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

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

describe('EditAppointmentUseCase', () => {
  it('changes service, barber and horario of any appointment, regardless of channel', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment());
    const useCase = new EditAppointmentUseCase(appointments);
    const newTimeRange: TimeWindow = { start: at('14:00'), end: at('14:30') };
    const searchWindow: TimeWindow = { start: at('09:00'), end: at('18:00') };

    const updated = await useCase.execute({
      appointmentId: 'appt-1',
      barberId: 'barber-2',
      serviceId: 'service-2',
      timeRange: newTimeRange,
      searchWindow,
    });

    expect(updated.barberId).toBe('barber-2');
    expect(updated.serviceId).toBe('service-2');
    expect(updated.timeRange).toEqual(newTimeRange);
    expect(appointments.updateScheduleCalls).toEqual([
      {
        id: 'appt-1',
        change: { barberId: 'barber-2', serviceId: 'service-2', timeRange: newTimeRange },
      },
    ]);
  });

  it('rejects editing an appointment that does not exist', async () => {
    const appointments = new FakeAppointmentRepository();
    const useCase = new EditAppointmentUseCase(appointments);

    await expect(
      useCase.execute({
        appointmentId: 'missing',
        barberId: 'barber-2',
        serviceId: 'service-2',
        timeRange: { start: at('14:00'), end: at('14:30') },
        searchWindow: { start: at('09:00'), end: at('18:00') },
      }),
    ).rejects.toBeInstanceOf(AppointmentNotFoundError);
  });
});
