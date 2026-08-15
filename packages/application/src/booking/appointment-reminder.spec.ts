import {
  FakeAppointmentReminderScheduler,
  FakeClock,
  FakeNotificationOutboxRepository,
  REMINDER_LEAD_MINUTES,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { AppointmentReminder, ScheduleAppointmentReminder } from './appointment-reminder';

// 6.10 RED — the reminder's decision contract. The handler is invoked at
// `appointmentStart - REMINDER_LEAD_MINUTES` by a per-appointment job (6.11);
// here it only decides WHAT to enqueue. Three facts drive it, taken straight
// from notification-port "Eventos mínimos que deben notificarse":
//   - a web turno with email + seña            → reminder_with_deposit
//   - a phone turno with email + no seña       → reminder_without_deposit
//   - a turno (any) whose client has NO email  → nothing — the email gates it
// The input carries no `channel`, so a reminder can never branch on it: a
// phone turno with a settled seña (not in MVP today, plausible tomorrow) maps
// exactly the same as a web one, and a web checkout never ends up here without
// an email, because the access code itself rides on email.
describe('AppointmentReminder', () => {
  const appointmentTime = '2026-09-01T13:00:00.000Z';

  it('enqueues reminder_with_deposit for a turno with email and a settled seña', async () => {
    const outbox = new FakeNotificationOutboxRepository();
    await new AppointmentReminder(outbox).execute({
      appointmentId: 'apt-web-1',
      clientEmail: 'cliente@jcbarberia.com',
      hasSettledDeposit: true,
      appointmentTime,
    });

    expect(outbox.enqueued).toEqual([
      {
        notificationType: 'reminder_with_deposit',
        recipientEmail: 'cliente@jcbarberia.com',
        payload: { appointmentId: 'apt-web-1', appointmentTime },
      },
    ]);
  });

  // notification-port spec, "Recordatorio para un turno telefónico sin seña":
  // a phone turno dispatched the SAME way as a web one — the only switch is
  // the seña (here absent), never the channel.
  it('enqueues reminder_without_deposit for a phone turno with email and no seña', async () => {
    const outbox = new FakeNotificationOutboxRepository();
    await new AppointmentReminder(outbox).execute({
      appointmentId: 'apt-phone-1',
      clientEmail: 'tel@jcbarberia.com',
      hasSettledDeposit: false,
      appointmentTime,
    });

    expect(outbox.enqueued).toEqual([
      {
        notificationType: 'reminder_without_deposit',
        recipientEmail: 'tel@jcbarberia.com',
        payload: { appointmentId: 'apt-phone-1', appointmentTime },
      },
    ]);
  });

  // admin-operations spec "Cliente telefónico sin email no recibe
  // recordatorio" — and the notification-port gate it comes from. Both a
  // would-be con-seña row and a sin-seña row with no email enqueue nothing.
  it('does NOT enqueue any reminder when the client has no email, con o sin seña', async () => {
    const outbox = new FakeNotificationOutboxRepository();
    const reminder = new AppointmentReminder(outbox);

    await reminder.execute({
      appointmentId: 'apt-no-email-1',
      clientEmail: null,
      hasSettledDeposit: true,
      appointmentTime,
    });
    await reminder.execute({
      appointmentId: 'apt-no-email-2',
      clientEmail: null,
      hasSettledDeposit: false,
      appointmentTime,
    });

    expect(outbox.enqueued).toEqual([]);
  });
});

// 6.11 GREEN — "schedule dinámico por turno": each appointment owns a job
// at `appointmentStart - REMINDER_LEAD_MINUTES`, not a fixed cron. The clock
// that booked the appointment computes both the start and the reminder time
// — never a wall-clock read inside the scheduler — so the test feeds a
// frozen clock and asserts the job is enqueued at exactly start − 2h.
describe('ScheduleAppointmentReminder', () => {
  const clock = new FakeClock();
  const at = (wall: string): Date => clock.localTimeToUtc('2026-09-01', wall);

  it('schedules appointment.reminder at appointmentStart - 2h (120 min)', async () => {
    const scheduler = new FakeAppointmentReminderScheduler();
    await new ScheduleAppointmentReminder(clock, scheduler).execute({
      appointmentId: 'apt-1',
      appointmentStart: at('13:00'),
    });

    expect(scheduler.scheduleCalls).toEqual([
      { appointmentId: 'apt-1', startAfter: at('11:00') },
    ]);
  });

  it('computes the lead relative to whatever the appointment start is — not a hardcoded wall time', async () => {
    const scheduler = new FakeAppointmentReminderScheduler();
    await new ScheduleAppointmentReminder(clock, scheduler).execute({
      appointmentId: 'apt-2',
      appointmentStart: at('18:00'),
    });

    // 18:00 minus REMINDER_LEAD_MINUTES → the reminder fires at 16:00.
    expect(scheduler.scheduleCalls[0]?.startAfter).toEqual(at('16:00'));
  });
});

// Mirror the constant the scheduler computes against, so a future edit to
// REMINDER_LEAD_MINUTES in the domain trips this file's expectation too.
it('reminder lead is 120 minutes (2h)', () => {
  expect(REMINDER_LEAD_MINUTES).toBe(120);
});
