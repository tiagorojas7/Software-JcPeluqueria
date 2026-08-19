import {
  FakeAppointmentReminderScheduler,
  FakeClientRepository,
  FakeClock,
  FakeHoldExpireScheduler,
  FakeHoldRepository,
  REMINDER_LEAD_MINUTES,
  type TimeWindow,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ScheduleAppointmentReminder } from '../booking/appointment-reminder';
import { CreateHold } from '../booking/create-hold';
import { CreatePhoneAppointmentUseCase } from './create-phone-appointment';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

describe('CreatePhoneAppointmentUseCase', () => {
  const timeRange: TimeWindow = { start: at('10:00'), end: at('10:30') };
  const searchWindow: TimeWindow = { start: at('09:00'), end: at('18:00') };

  function buildUseCase() {
    const clients = new FakeClientRepository();
    const holds = new FakeHoldRepository();
    const clock = new FakeClock(-180, at('09:45'));
    // Phase 6 (6.3) gave `CreateHold` a `HoldExpireScheduler`: every hold it
    // creates enqueues its own expiry. A phone appointment is confirmed
    // immediately after, so the job fires on an already-`reservado` row and
    // finds nothing to release — harmless, and not this test's subject.
    const createHold = new CreateHold(holds, clock, new FakeHoldExpireScheduler());
    const reminderScheduler = new FakeAppointmentReminderScheduler();
    const scheduleReminder = new ScheduleAppointmentReminder(clock, reminderScheduler);
    const useCase = new CreatePhoneAppointmentUseCase(clients, holds, createHold, scheduleReminder);
    return { useCase, clients, holds, reminderScheduler };
  }

  it('books a new client directly into reservado, with no deposit', async () => {
    const { useCase, holds } = buildUseCase();

    const appointment = await useCase.execute({
      id: 'appt-1',
      barberId: 'barber-1',
      serviceId: 'service-1',
      timeRange,
      searchWindow,
      client: { name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: 30 },
    });

    expect(appointment.status).toBe('reservado');
    expect(appointment.channel).toBe('telefonico');
    expect(appointment.deposit).toEqual({ kind: 'not_applicable' });
    expect(holds.createCalls[0]?.hold.channel).toBe('telefonico');
    expect(holds.confirmCalls).toEqual(['appt-1']);
  });

  it('creates the appointment without email, no blocking whatsoever', async () => {
    const { useCase } = buildUseCase();

    const appointment = await useCase.execute({
      id: 'appt-2',
      barberId: 'barber-1',
      serviceId: 'service-1',
      timeRange,
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
      serviceId: 'service-1',
      timeRange,
      searchWindow,
      client: { name: 'Marcos', phone: '3511234567', email: null, age: null },
    });

    expect(appointment.clientId).toBe(existing.id);
  });

  // E.2 (cablear-el-mvp Slice E): a phone appointment is confirmed the moment
  // it is created — there is no payment step to wait for — so the 2h
  // reminder is scheduled off the SAME `timeRange.start` right here, using
  // the same `Clock` that computed it, never a fresh wall-clock read.
  it('schedules the 2h appointment.reminder job at timeRange.start - 120min', async () => {
    const { useCase, reminderScheduler } = buildUseCase();

    const appointment = await useCase.execute({
      id: 'appt-4',
      barberId: 'barber-1',
      serviceId: 'service-1',
      timeRange,
      searchWindow,
      client: { name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: 30 },
    });

    expect(reminderScheduler.scheduleCalls).toEqual([
      {
        appointmentId: appointment.id,
        startAfter: dateBuilder.addMinutes(timeRange.start, -REMINDER_LEAD_MINUTES),
      },
    ]);
  });
});
