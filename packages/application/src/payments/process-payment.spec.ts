import {
  FakeAppointmentRepository,
  FakeAppointmentReminderScheduler,
  FakeClock,
  FakeDepositRepository,
  FakePaymentPort,
  REMINDER_LEAD_MINUTES,
  type Appointment,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ScheduleAppointmentReminder } from '../booking/appointment-reminder';
import { ProcessPaymentUseCase } from './process-payment';

const clock = new FakeClock();
const at = (time: string) => clock.localTimeToUtc('2026-09-01', time);

function anAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'hold-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'web',
    timeRange: { start: at('14:00'), end: at('14:30') },
    status: 'reservado',
    deposit: { kind: 'settled', paymentId: 'payment-1', amountCents: 250000 },
    ...overrides,
  };
}

function buildUseCase(paymentPort: FakePaymentPort) {
  const deposits = new FakeDepositRepository();
  const appointments = new FakeAppointmentRepository();
  const reminderScheduler = new FakeAppointmentReminderScheduler();
  const scheduleReminder = new ScheduleAppointmentReminder(clock, reminderScheduler);
  const useCase = new ProcessPaymentUseCase(paymentPort, deposits, appointments, scheduleReminder);
  return { useCase, deposits, appointments, reminderScheduler };
}

describe('ProcessPaymentUseCase', () => {
  // design.md: "El redirect del navegador no es fuente de verdad. El worker
  // consulta GET /v1/payments/:id antes de confirmar."
  it('confirms the hold only after reading the approved status back from MercadoPago', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-1',
      status: 'approved',
      amountCents: 250000,
      externalReference: 'hold-1',
    });
    const { useCase, deposits, appointments } = buildUseCase(paymentPort);
    appointments.seed(anAppointment({ id: 'hold-1' }));

    const result = await useCase.execute('payment-1');

    expect(result).toEqual({ outcome: 'confirmed' });
    expect(paymentPort.getPaymentCalls).toEqual(['payment-1']);
    expect(deposits.calls).toEqual([{ holdId: 'hold-1', paymentId: 'payment-1', amountCents: 250000 }]);
  });

  // E.2 (cablear-el-mvp Slice E): a web booking's appointment only becomes
  // `reservado` HERE, when the deposit settles — this is the second (and
  // last) producer `ScheduleAppointmentReminder` needs, the confirmation
  // path for the deposit-gated half of booking.
  it('schedules the 2h appointment.reminder job right after confirming a settled deposit', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-1',
      status: 'approved',
      amountCents: 250000,
      externalReference: 'hold-1',
    });
    const { useCase, appointments, reminderScheduler } = buildUseCase(paymentPort);
    const appointment = anAppointment({ id: 'hold-1' });
    appointments.seed(appointment);

    await useCase.execute('payment-1');

    expect(reminderScheduler.scheduleCalls).toEqual([
      {
        appointmentId: 'hold-1',
        startAfter: clock.addMinutes(appointment.timeRange.start, -REMINDER_LEAD_MINUTES),
      },
    ]);
  });

  // Threat matrix: "reintento del mismo payment_id → cero filas afectadas".
  // Application-layer proof; the atomic database guarantee is
  // DrizzleDepositRepository's own Testcontainers suite.
  it('is idempotent — the second call for the same payment_id is a no-op', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-3',
      status: 'approved',
      amountCents: 250000,
      externalReference: 'hold-3',
    });
    const { useCase, appointments, reminderScheduler } = buildUseCase(paymentPort);
    appointments.seed(anAppointment({ id: 'hold-3' }));

    await useCase.execute('payment-3');
    const retry = await useCase.execute('payment-3');

    expect(retry).toEqual({ outcome: 'already-processed' });
    // The retry is a no-op on the deposit — it must be a no-op on the
    // reminder too, never a SECOND job for the same appointment.
    expect(reminderScheduler.scheduleCalls).toHaveLength(1);
  });

  // Task 5.15 — client-booking spec: "Falla el cobro de la seña". design.md
  // line 152: "Si MercadoPago responde `rejected` o `cancelled`, se libera
  // de inmediato sin esperar los 15 minutos." A `rejected` payment MUST NOT
  // leave the hold `held+payment_pending` (which would freeze the slot past
  // expiry per the 5.18 fix); the worker itself unlocks the slot now.
  it('releases the hold immediately on `rejected` and never records a settled deposit', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-4',
      status: 'rejected',
      amountCents: 250000,
      externalReference: 'hold-4',
    });
    const { useCase, deposits, reminderScheduler } = buildUseCase(paymentPort);

    const result = await useCase.execute('payment-4');

    expect(deposits.calls).toEqual([]); // MUST NOT create el turno reservado
    expect(deposits.releaseCalls).toEqual([{ holdId: 'hold-4' }]);
    expect(result).toEqual({ outcome: 'released', status: 'rejected' });
    expect(reminderScheduler.scheduleCalls).toEqual([]); // nothing to remind about
  });

  // `cancelled` is the other terminal-failure status design.md calls out by
  // name in the same sentence — same path, same release.
  it('releases the hold immediately on `cancelled` too', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-5',
      status: 'cancelled',
      amountCents: 250000,
      externalReference: 'hold-5',
    });
    const { useCase, deposits } = buildUseCase(paymentPort);

    const result = await useCase.execute('payment-5');

    expect(deposits.calls).toEqual([]);
    expect(deposits.releaseCalls).toEqual([{ holdId: 'hold-5' }]);
    expect(result).toEqual({ outcome: 'released', status: 'cancelled' });
  });

  // `pending`/`in_process` are NOT terminal — the payment can still flip to
  // `approved` seconds later. design.md line 150: a hold with a payment in
  // course is "nunca lo libera el temporizador". Releasing here would be the
  // exact race the rule exists to prevent.
  it('leaves the hold untouched on a non-terminal status (pending)', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-6',
      status: 'pending',
      amountCents: 250000,
      externalReference: 'hold-6',
    });
    const { useCase, deposits } = buildUseCase(paymentPort);

    const result = await useCase.execute('payment-6');

    expect(deposits.calls).toEqual([]);
    expect(deposits.releaseCalls).toEqual([]);
    expect(result).toEqual({ outcome: 'ignored', status: 'pending' });
  });

  // Idempotency on the rejection side too: a webhook retried for a payment
  // that ended `rejected` fires `payment.process` twice — the second call
  // must observe a no-op, never re-release nor error.
  it('is idempotent on rejection — the second call for the same rejected payment reports no-op', async () => {
    const paymentPort = new FakePaymentPort({
      paymentId: 'payment-7',
      status: 'rejected',
      amountCents: 250000,
      externalReference: 'hold-7',
    });
    const { useCase, deposits } = buildUseCase(paymentPort);

    const first = await useCase.execute('payment-7');
    const retry = await useCase.execute('payment-7');

    expect(first).toEqual({ outcome: 'released', status: 'rejected' });
    expect(retry).toEqual({ outcome: 'no-op', status: 'rejected' });
    expect(deposits.releaseCalls).toHaveLength(2); // both calls observed, second affected nothing
  });
});
