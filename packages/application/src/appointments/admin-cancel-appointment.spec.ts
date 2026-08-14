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
    const useCase = new AdminCancelAppointmentUseCase(appointments, paymentPort);

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
    const useCase = new AdminCancelAppointmentUseCase(appointments, paymentPort);

    const cancelled = await useCase.execute('appt-1');

    expect(cancelled.status).toBe('cancelado');
    expect(cancelled.deposit.kind).toBe('refunded');
    expect(paymentPort.refundCalls).toEqual([{ paymentId: 'pay-1', amountCents: 500000 }]);
  });

  it('rejects cancelling an appointment that does not exist', async () => {
    const appointments = new FakeAppointmentRepository();
    const paymentPort = new FakePaymentPort();
    const useCase = new AdminCancelAppointmentUseCase(appointments, paymentPort);

    await expect(useCase.execute('missing')).rejects.toBeInstanceOf(AppointmentNotFoundError);
  });
});
