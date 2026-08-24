import {
  AppointmentNotFoundError,
  createBarber,
  createService,
  FakeAppointmentRepository,
  FakeBarberRepository,
  FakeClientRepository,
  FakeClock,
  FakeNotificationOutboxRepository,
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
const NEW_BARBER_ID = 'barber-2';

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
  const barbers = new FakeBarberRepository();
  barbers.create(createBarber({ id: NEW_BARBER_ID, name: 'Facundo Diaz', active: true }));
  const clients = new FakeClientRepository();
  const outbox = new FakeNotificationOutboxRepository();
  const clock = new FakeClock();
  const useCase = new EditAppointmentUseCase(appointments, services, barbers, clients, outbox, clock);
  return { useCase, appointments, services, barbers, clients, outbox, clock };
}

describe('EditAppointmentUseCase', () => {
  it('changes service, barber and horario of any appointment, regardless of channel, deriving endTime from the target service', async () => {
    const { useCase, appointments } = buildUseCase();
    appointments.seed(buildAppointment());
    const searchWindow: TimeWindow = { start: at('09:00'), end: at('18:00') };

    const updated = await useCase.execute({
      appointmentId: 'appt-1',
      barberId: NEW_BARBER_ID,
      serviceId: SERVICE_ID,
      startsAt: at('14:00'),
      searchWindow,
    });

    expect(updated.barberId).toBe(NEW_BARBER_ID);
    expect(updated.serviceId).toBe(SERVICE_ID);
    expect(updated.timeRange).toEqual({ start: at('14:00'), end: at('14:30') });
    expect(appointments.updateScheduleCalls).toEqual([
      {
        id: 'appt-1',
        change: {
          barberId: NEW_BARBER_ID,
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
        barberId: NEW_BARBER_ID,
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
        barberId: NEW_BARBER_ID,
        serviceId: 'no-such-service',
        startsAt: at('14:00'),
        searchWindow: { start: at('09:00'), end: at('18:00') },
      }),
    ).rejects.toBeInstanceOf(EditAppointmentServiceNotFoundError);
    expect(appointments.updateScheduleCalls).toHaveLength(0);
  });

  // panel-usable: "nobody tells the client their appointment changed" — an
  // edit that succeeds now enqueues a notification telling the client what
  // the turno is NOW (barber, service, shop-local time).
  describe('notifica al cliente que su turno cambio', () => {
    it('encola appointment_updated con el barbero/servicio/hora vigentes, cuando el cliente tiene email', async () => {
      const { useCase, appointments, clients, outbox } = buildUseCase();
      appointments.seed(buildAppointment({ clientId: 'client-with-email' }));
      clients.seed({ id: 'client-with-email', name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: null });

      await useCase.execute({
        appointmentId: 'appt-1',
        barberId: NEW_BARBER_ID,
        serviceId: SERVICE_ID,
        startsAt: at('14:00'),
        searchWindow: { start: at('09:00'), end: at('18:00') },
      });

      expect(outbox.enqueued).toEqual([
        {
          notificationType: 'appointment_updated',
          recipientEmail: 'marcos@example.com',
          payload: {
            barberName: 'Facundo Diaz',
            serviceName: 'Corte + Barba',
            appointmentTime: at('14:00').toISOString(),
          },
        },
      ]);
    });

    it('no encola nada, y no lanza, cuando el cliente no tiene email registrado', async () => {
      const { useCase, appointments, clients, outbox } = buildUseCase();
      appointments.seed(buildAppointment({ clientId: 'client-no-email' }));
      clients.seed({ id: 'client-no-email', name: 'Laura', phone: '3512223344', email: null, age: null });

      await useCase.execute({
        appointmentId: 'appt-1',
        barberId: NEW_BARBER_ID,
        serviceId: SERVICE_ID,
        startsAt: at('14:00'),
        searchWindow: { start: at('09:00'), end: at('18:00') },
      });

      expect(outbox.enqueued).toEqual([]);
    });

    it('no lanza cuando el cliente del turno ya no existe — nunca revienta la edicion por una notificacion', async () => {
      const { useCase, appointments, outbox } = buildUseCase();
      appointments.seed(buildAppointment({ clientId: 'client-gone' }));

      await expect(
        useCase.execute({
          appointmentId: 'appt-1',
          barberId: NEW_BARBER_ID,
          serviceId: SERVICE_ID,
          startsAt: at('14:00'),
          searchWindow: { start: at('09:00'), end: at('18:00') },
        }),
      ).resolves.toBeDefined();
      expect(outbox.enqueued).toEqual([]);
    });
  });
});
