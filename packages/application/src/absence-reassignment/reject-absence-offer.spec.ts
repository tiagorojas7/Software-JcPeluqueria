import {
  FakeAppointmentRepository,
  FakeClock,
  FakePaymentPort,
  type Appointment,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { RejectOfferUseCase } from './reject-absence-offer';

const clock = new FakeClock();
const at = (time: string) => clock.localTimeToUtc('2026-09-07', time);

const originalAppointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'appointment-1',
  barberId: 'barber-absent',
  serviceId: 'service-1',
  clientId: 'client-1',
  channel: 'web',
  timeRange: { start: at('10:00'), end: at('10:30') },
  status: 'reservado',
  deposit: { kind: 'not_applicable' },
  ...overrides,
});

// 12.9 RED — derived from specs/barber-absence-reassignment/spec.md:
//
//   "Requirement: Rechazo o falta de respuesta cancela el turno original"
//   "Si el cliente rechaza todas las ofertas ... el sistema MUST
//   transicionar el turno original a `cancelado`. Si el turno original
//   tenía seña, el sistema MUST reembolsarla automáticamente"
//
//   Scenario "Cliente rechaza explícitamente, con seña":
//     GIVEN una oferta activa para un turno original con seña
//     WHEN el cliente rechaza todas las opciones
//     THEN el turno original pasa a `cancelado`
//     AND el sistema reembolsa automáticamente la seña
describe('RejectOfferUseCase', () => {
  it('cancels the original appointment and automatically refunds its settled deposit', async () => {
    const appointments = new FakeAppointmentRepository();
    const paymentPort = new FakePaymentPort();
    appointments.seed(
      originalAppointment({ deposit: { kind: 'settled', paymentId: 'mp-1', amountCents: 250000 } }),
    );
    const useCase = new RejectOfferUseCase(appointments, paymentPort);

    const result = await useCase.execute({ originalAppointmentId: 'appointment-1' });

    expect(result.outcome).toBe('cancelled');
    if (result.outcome !== 'cancelled') throw new Error('unreachable');
    expect(result.appointment.status).toBe('cancelado');
    expect(result.appointment.deposit.kind).toBe('refunded');
    expect(paymentPort.refundCalls).toEqual([{ paymentId: 'mp-1', amountCents: 250000 }]);
    expect(appointments.updateStatusCalls).toEqual([{ id: 'appointment-1', status: 'cancelado' }]);
  });

  // Requirement's other explicit branch, the "sin seña" half — no gateway
  // call, because there is nothing to return: resolveDepositForCancellation
  // (Phase 4) treats not_applicable as a no-op on the money side while the
  // cancellation itself still happens.
  it('cancels a telefonico appointment without a deposit — no refund action executes', async () => {
    const appointments = new FakeAppointmentRepository();
    const paymentPort = new FakePaymentPort();
    appointments.seed(originalAppointment({ deposit: { kind: 'not_applicable' } }));
    const useCase = new RejectOfferUseCase(appointments, paymentPort);

    const result = await useCase.execute({ originalAppointmentId: 'appointment-1' });

    expect(result.outcome).toBe('cancelled');
    if (result.outcome !== 'cancelled') throw new Error('unreachable');
    expect(result.appointment.deposit).toEqual({ kind: 'not_applicable' });
    expect(paymentPort.refundCalls).toEqual([]);
  });

  it('reports not-cancellable for an appointment id that does not exist, instead of throwing', async () => {
    const appointments = new FakeAppointmentRepository();
    const paymentPort = new FakePaymentPort();
    const useCase = new RejectOfferUseCase(appointments, paymentPort);

    const result = await useCase.execute({ originalAppointmentId: 'does-not-exist' });

    expect(result).toEqual({ outcome: 'not-cancellable' });
  });

  it('reports not-cancellable for an appointment already in a terminal state — never a second cancellation', async () => {
    const appointments = new FakeAppointmentRepository();
    const paymentPort = new FakePaymentPort();
    appointments.seed(originalAppointment({ status: 'cancelado' }));
    const useCase = new RejectOfferUseCase(appointments, paymentPort);

    const result = await useCase.execute({ originalAppointmentId: 'appointment-1' });

    expect(result).toEqual({ outcome: 'not-cancellable' });
    expect(appointments.updateStatusCalls).toEqual([]);
  });
});
