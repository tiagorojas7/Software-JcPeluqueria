import type { AppointmentReminderScheduler } from '../appointment-reminder-scheduler';

export interface RecordedScheduleReminderCall {
  readonly appointmentId: string;
  readonly startAfter: Date;
}

/** In-memory `AppointmentReminderScheduler` test double — records every
 *  enqueue call, never runs one, so a unit test can assert an
 *  `appointment.reminder` job was scheduled with the right `startAfter`
 *  (exactly `appointmentStart - REMINDER_LEAD_MINUTES`) without a real queue. */
export class FakeAppointmentReminderScheduler implements AppointmentReminderScheduler {
  readonly scheduleCalls: RecordedScheduleReminderCall[] = [];

  async scheduleReminder(input: { appointmentId: string; startAfter: Date }): Promise<void> {
    this.scheduleCalls.push({ appointmentId: input.appointmentId, startAfter: input.startAfter });
  }
}
