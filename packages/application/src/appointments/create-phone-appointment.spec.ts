import {
  createBarber,
  createService,
  FakeAppointmentReminderScheduler,
  FakeBarberRepository,
  FakeClientRepository,
  FakeClock,
  FakeHoldExpireScheduler,
  FakeHoldRepository,
  FakeNotificationOutboxRepository,
  FakeServiceRepository,
  REMINDER_LEAD_MINUTES,
  type TimeWindow,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ScheduleAppointmentReminder } from '../booking/appointment-reminder';
import { CreateHold } from '../booking/create-hold';
import { CreatePhoneAppointmentUseCase, PhoneAppointmentServiceNotFoundError } from './create-phone-appointment';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

// admin-operations spec: the secretary picks a service, never types an end
// time — the appointment's duration always comes from the service she
// selected (`Service.durationMinutes`), never from a second field she would
// have to keep consistent by hand.
const HAIRCUT_SERVICE_ID = 'service-1';
const HAIRCUT_DURATION_MINUTES = 30;

describe('CreatePhoneAppointmentUseCase', () => {
  const searchWindow: TimeWindow = { start: at('09:00'), end: at('18:00') };

  function buildUseCase() {
    const clients = new FakeClientRepository();
    const holds = new FakeHoldRepository();
    const clock = new FakeClock(-180, at('09:45'));
    const services = new FakeServiceRepository();
    services.create(
      createService({
        id: HAIRCUT_SERVICE_ID,
        name: 'Corte clasico',
        durationMinutes: HAIRCUT_DURATION_MINUTES,
        priceCents: 500000,
      }),
    );
    // Phase 6 (6.3) gave `CreateHold` a `HoldExpireScheduler`: every hold it
    // creates enqueues its own expiry. A phone appointment is confirmed
    // immediately after, so the job fires on an already-`reservado` row and
    // finds nothing to release — harmless, and not this test's subject.
    const createHold = new CreateHold(holds, clock, new FakeHoldExpireScheduler());
    const reminderScheduler = new FakeAppointmentReminderScheduler();
    const scheduleReminder = new ScheduleAppointmentReminder(clock, reminderScheduler);
    const outbox = new FakeNotificationOutboxRepository();
    const barbers = new FakeBarberRepository();
    barbers.create(createBarber({ id: 'barber-1', name: 'Cristian Gomez', active: true }));
    const useCase = new CreatePhoneAppointmentUseCase(
      clients,
      holds,
      createHold,
      scheduleReminder,
      services,
      clock,
      outbox,
      barbers,
    );
    return { useCase, clients, holds, reminderScheduler, services, clock, outbox, barbers };
  }

  // El dueño: "los turnos que se agendan telefonicamente y se agrega mail,
  // tambien tiene que llegar las notificaciones". Un turno telefonico queda
  // `reservado` en el acto, igual que uno web una vez acreditada la seña, asi
  // que merece el mismo aviso — y hasta ahora no mandaba ninguno.
  it('encola la confirmacion cuando el cliente dejo su mail', async () => {
    const { useCase, outbox } = buildUseCase();

    const appointment = await useCase.execute({
      id: 'appt-mail',
      barberId: 'barber-1',
      serviceId: HAIRCUT_SERVICE_ID,
      startsAt: at('10:00'),
      searchWindow,
      client: { name: 'Sofia', phone: '3510001111', email: 'sofia@example.com' },
    });

    expect(outbox.enqueued).toEqual([
      {
        notificationType: 'booking_confirmed',
        recipientEmail: 'sofia@example.com',
        payload: {
          appointmentId: appointment.id,
          barberName: 'Cristian Gomez',
          serviceName: 'Corte clasico',
          appointmentTime: at('10:00').toISOString(),
          // Un turno telefonico no lleva seña: el mail no puede afirmarle al
          // cliente que ya pago algo que no pago.
          depositPaid: 'false',
        },
      },
    ]);
  });

  // Misma compuerta que ya aplican `ProcessPaymentUseCase` y
  // `AppointmentReminder`: sin mail no hay envio, y el turno se agenda igual.
  // Un turno telefonico sin mail es un caso normal, no un error.
  it('agenda el turno igual cuando no hay mail, sin encolar nada', async () => {
    const { useCase, outbox } = buildUseCase();

    const appointment = await useCase.execute({
      id: 'appt-sin-mail',
      barberId: 'barber-1',
      serviceId: HAIRCUT_SERVICE_ID,
      startsAt: at('11:00'),
      searchWindow,
      client: { name: 'Sin Mail', phone: '3510002222' },
    });

    expect(appointment.status).toBe('reservado');
    expect(outbox.enqueued).toEqual([]);
  });

  it('books a new client directly into reservado, with no deposit', async () => {
    const { useCase, holds } = buildUseCase();

    const appointment = await useCase.execute({
      id: 'appt-1',
      barberId: 'barber-1',
      serviceId: HAIRCUT_SERVICE_ID,
      startsAt: at('10:00'),
      searchWindow,
      client: { name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: 30 },
    });

    expect(appointment.status).toBe('reservado');
    expect(appointment.channel).toBe('telefonico');
    expect(appointment.deposit).toEqual({ kind: 'not_applicable' });
    expect(holds.createCalls[0]?.hold.channel).toBe('telefonico');
    expect(holds.confirmCalls).toEqual(['appt-1']);
  });

  // The exact property the owner asked to guarantee: a turno's duration
  // never disagrees with its service. Derived server-side from
  // Service.durationMinutes via the same Clock every other instant in this
  // codebase goes through — never trusted from a caller-supplied endTime.
  it("derives the appointment's end time from the selected service's durationMinutes, never from caller input", async () => {
    const { useCase } = buildUseCase();

    const appointment = await useCase.execute({
      id: 'appt-1b',
      barberId: 'barber-1',
      serviceId: HAIRCUT_SERVICE_ID,
      startsAt: at('10:00'),
      searchWindow,
      client: { name: 'Marcos', phone: '3511234567', email: null, age: null },
    });

    expect(appointment.timeRange).toEqual({ start: at('10:00'), end: at('10:30') });
  });

  it('creates the appointment without email, no blocking whatsoever', async () => {
    const { useCase } = buildUseCase();

    const appointment = await useCase.execute({
      id: 'appt-2',
      barberId: 'barber-1',
      serviceId: HAIRCUT_SERVICE_ID,
      startsAt: at('10:00'),
      searchWindow,
      client: { name: 'Laura', phone: '3517654321', email: null, age: null },
    });

    expect(appointment.status).toBe('reservado');
    expect(appointment.deposit).toEqual({ kind: 'not_applicable' });
  });

  it('reuses an existing client found by phone instead of creating a duplicate', async () => {
    const { useCase, clients } = buildUseCase();
    const existing = await clients.create({ name: 'Marcos', phone: '3511234567', email: null, age: null });

    const appointment = await useCase.execute({
      id: 'appt-3',
      barberId: 'barber-1',
      serviceId: HAIRCUT_SERVICE_ID,
      startsAt: at('10:00'),
      searchWindow,
      client: { name: 'Marcos', phone: '3511234567', email: null, age: null },
    });

    expect(appointment.clientId).toBe(existing.id);
  });

  // E.2 (cablear-el-mvp Slice E): a phone appointment is confirmed the moment
  // it is created — there is no payment step to wait for — so the 2h
  // reminder is scheduled off the SAME derived start right here, using the
  // same `Clock` that computed it, never a fresh wall-clock read.
  it('schedules the 2h appointment.reminder job at startsAt - 120min', async () => {
    const { useCase, reminderScheduler } = buildUseCase();

    const appointment = await useCase.execute({
      id: 'appt-4',
      barberId: 'barber-1',
      serviceId: HAIRCUT_SERVICE_ID,
      startsAt: at('10:00'),
      searchWindow,
      client: { name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: 30 },
    });

    expect(reminderScheduler.scheduleCalls).toEqual([
      {
        appointmentId: appointment.id,
        startAfter: dateBuilder.addMinutes(at('10:00'), -REMINDER_LEAD_MINUTES),
      },
    ]);
  });

  it('rejects a serviceId that does not exist, never guessing a duration', async () => {
    const { useCase } = buildUseCase();

    await expect(
      useCase.execute({
        id: 'appt-5',
        barberId: 'barber-1',
        serviceId: 'no-such-service',
        startsAt: at('10:00'),
        searchWindow,
        client: { name: 'Marcos', phone: '3511234567', email: null, age: null },
      }),
    ).rejects.toBeInstanceOf(PhoneAppointmentServiceNotFoundError);
  });
});
