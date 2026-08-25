import {
  AppointmentNotFoundError,
  FakeAppointmentRepository,
  FakeClock,
  FakePaymentPort,
  type Appointment,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { AdminCancelAppointmentUseCase } from './admin-cancel-appointment';

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

describe('AdminCancelAppointmentUseCase', () => {
  it('cancels a phone appointment with no deposit — no refund attempted', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment());
    const paymentPort = new FakePaymentPort();
    const useCase = new AdminCancelAppointmentUseCase(appointments, paymentPort, new FakeClock(-180, at('08:00')));

    const cancelled = await useCase.execute('appt-1');

    expect(cancelled.status).toBe('cancelado');
    expect(cancelled.deposit).toEqual({ kind: 'not_applicable' });
    expect(paymentPort.refundCalls).toEqual([]);
    expect(appointments.updateStatusCalls).toEqual([{ id: 'appt-1', status: 'cancelado' }]);
  });

  it('refunds automatically when the appointment carries a settled deposit', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(
      buildAppointment({
        channel: 'web',
        deposit: { kind: 'settled', paymentId: 'pay-1', amountCents: 500000 },
      }),
    );
    const paymentPort = new FakePaymentPort();
    const useCase = new AdminCancelAppointmentUseCase(appointments, paymentPort, new FakeClock(-180, at('08:00')));

    const cancelled = await useCase.execute('appt-1');

    expect(cancelled.status).toBe('cancelado');
    expect(cancelled.deposit.kind).toBe('refunded');
    expect(paymentPort.refundCalls).toEqual([{ paymentId: 'pay-1', amountCents: 500000 }]);
  });

  it('rejects cancelling an appointment that does not exist', async () => {
    const appointments = new FakeAppointmentRepository();
    const paymentPort = new FakePaymentPort();
    const useCase = new AdminCancelAppointmentUseCase(appointments, paymentPort, new FakeClock(-180, at('08:00')));

    await expect(useCase.execute('missing')).rejects.toBeInstanceOf(AppointmentNotFoundError);
  });
});

// RED — the shop owner's rule, stated for the panel exactly as it already
// holds for "Mi cuenta": cancelling from the panel MUST follow the same money
// rule as the client's own cancellation — the seña comes back up to one hour
// before the turno, and is forfeited after that. The panel used to refund
// unconditionally, which is wrong in both directions: it gave back money the
// shop had earned on a last-minute cancellation, and it fired a MercadoPago
// refund for turnos where no refund was ever due.
describe('AdminCancelAppointmentUseCase — la ventana de una hora', () => {
  const buildUseCase = (now: Date) => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(
      buildAppointment({
        channel: 'web',
        deposit: { kind: 'settled', paymentId: 'pay-1', amountCents: 500000 },
      }),
    );
    const paymentPort = new FakePaymentPort();
    const useCase = new AdminCancelAppointmentUseCase(appointments, paymentPort, new FakeClock(-180, now));
    return { useCase, appointments, paymentPort };
  };

  it('refunds when the panel cancels more than an hour before the turno', async () => {
    const { useCase, paymentPort } = buildUseCase(at('08:30'));

    const cancelled = await useCase.execute('appt-1');

    expect(cancelled.deposit.kind).toBe('refunded');
    expect(paymentPort.refundCalls).toEqual([{ paymentId: 'pay-1', amountCents: 500000 }]);
  });

  it('forfeits the seña — and never calls MercadoPago — inside the last hour', async () => {
    const { useCase, appointments, paymentPort } = buildUseCase(at('09:30'));

    const cancelled = await useCase.execute('appt-1');

    expect(cancelled.status).toBe('cancelado');
    expect(cancelled.deposit).toEqual({ kind: 'forfeited', amountCents: 500000 });
    // The turno is released either way — the window decides the money, never
    // whether the panel may cancel.
    expect(appointments.updateStatusCalls).toEqual([{ id: 'appt-1', status: 'cancelado' }]);
    expect(paymentPort.refundCalls).toEqual([]);
  });

  it('treats the cutoff instant itself as still inside the window', async () => {
    const { useCase, paymentPort } = buildUseCase(at('09:00'));

    const cancelled = await useCase.execute('appt-1');

    expect(cancelled.deposit.kind).toBe('refunded');
    expect(paymentPort.refundCalls).toHaveLength(1);
  });

  it('cancels a phone turno inside the last hour with no money to move at all', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment());
    const paymentPort = new FakePaymentPort();
    const useCase = new AdminCancelAppointmentUseCase(appointments, paymentPort, new FakeClock(-180, at('09:45')));

    const cancelled = await useCase.execute('appt-1');

    expect(cancelled.status).toBe('cancelado');
    expect(cancelled.deposit).toEqual({ kind: 'not_applicable' });
    expect(paymentPort.refundCalls).toEqual([]);
  });
});
