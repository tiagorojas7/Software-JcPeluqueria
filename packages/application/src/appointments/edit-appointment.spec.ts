import {
  AppointmentNotFoundError,
  createService,
  FakeAppointmentRepository,
  FakeClock,
  FakeServiceRepository,
  type Appointment,
  type TimeWindow,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { EditAppointmentServiceNotFoundError, EditAppointmentUseCase } from './edit-appointment';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

const SERVICE_ID = 'service-2';
const SERVICE_DURATION_MINUTES = 30;

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

function buildUseCase() {
  const appointments = new FakeAppointmentRepository();
  const services = new FakeServiceRepository();
  services.create(
    createService({ id: SERVICE_ID, name: 'Corte + Barba', durationMinutes: SERVICE_DURATION_MINUTES, priceCents: 900000 }),
  );
  const clock = new FakeClock();
  const useCase = new EditAppointmentUseCase(appointments, services, clock);
  return { useCase, appointments, services, clock };
}

describe('EditAppointmentUseCase', () => {
  it('changes service, barber and horario of any appointment, regardless of channel, deriving endTime from the target service', async () => {
    const { useCase, appointments } = buildUseCase();
    appointments.seed(buildAppointment());
    const searchWindow: TimeWindow = { start: at('09:00'), end: at('18:00') };

    const updated = await useCase.execute({
      appointmentId: 'appt-1',
      barberId: 'barber-2',
      serviceId: SERVICE_ID,
      startsAt: at('14:00'),
      searchWindow,
    });

    expect(updated.barberId).toBe('barber-2');
    expect(updated.serviceId).toBe(SERVICE_ID);
    expect(updated.timeRange).toEqual({ start: at('14:00'), end: at('14:30') });
    expect(appointments.updateScheduleCalls).toEqual([
      {
        id: 'appt-1',
        change: {
          barberId: 'barber-2',
          serviceId: SERVICE_ID,
          timeRange: { start: at('14:00'), end: at('14:30') },
        },
      },
    ]);
  });

  it('rejects editing an appointment that does not exist', async () => {
    const { useCase } = buildUseCase();

    await expect(
      useCase.execute({
        appointmentId: 'missing',
        barberId: 'barber-2',
        serviceId: SERVICE_ID,
        startsAt: at('14:00'),
        searchWindow: { start: at('09:00'), end: at('18:00') },
      }),
    ).rejects.toBeInstanceOf(AppointmentNotFoundError);
  });

  it('rejects editing into a service that does not exist, before writing anything', async () => {
    const { useCase, appointments } = buildUseCase();
    appointments.seed(buildAppointment());

    await expect(
      useCase.execute({
        appointmentId: 'appt-1',
        barberId: 'barber-2',
        serviceId: 'no-such-service',
        startsAt: at('14:00'),
        searchWindow: { start: at('09:00'), end: at('18:00') },
      }),
    ).rejects.toBeInstanceOf(EditAppointmentServiceNotFoundError);
    expect(appointments.updateScheduleCalls).toHaveLength(0);
  });
});
