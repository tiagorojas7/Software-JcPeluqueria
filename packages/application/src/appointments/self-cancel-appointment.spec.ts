import {
  FakeAppointmentRepository,
  FakeClock,
  FakePaymentPort,
  type Appointment,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { SELF_CANCEL_WINDOW_MINUTES, SelfCancelAppointmentUseCase } from './self-cancel-appointment';

// 9.13 / 9.14 / 9.16 RED — derived from specs/client-booking/spec.md, not from
// an implementation:
//
//   "Cancelación del cliente con reembolso automático": the client MAY cancel
//   their own reserved web appointment up to 1 hour before it starts, and every
//   cancellation inside that window MUST trigger an automatic refund with no
//   manual approval.
//
//   "El cliente solo actúa sobre sus propios datos": every self-service action
//   is restricted to the authenticated client's own appointments.
//
// The client is deliberately identified by a plain `clientId`, not by
// `ActorContext`: that type's `role` is `owner | secretary | barber` (Phase 3b)
// and has no client member. A client's identity lives in `users.client_id`,
// resolved by the endpoint — the use case only needs to know WHOSE it is.

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'web',
    timeRange: { start: at('10:00'), end: at('10:30') },
    status: 'reservado',
    deposit: { kind: 'settled', paymentId: 'pay-1', amountCents: 500000 },
    ...overrides,
  };
}

/** `now` is the only knob every case turns, so each test states its own. */
function buildUseCase(now: Date, appointment: Appointment = buildAppointment()) {
  const appointments = new FakeAppointmentRepository();
  appointments.seed(appointment);
  const paymentPort = new FakePaymentPort();
  const clock = new FakeClock(-180, now);
  const useCase = new SelfCancelAppointmentUseCase(appointments, paymentPort, clock);
  return { useCase, appointments, paymentPort };
}

describe('SelfCancelAppointmentUseCase', () => {
  describe('Cancelación dentro de la ventana permitida', () => {
    it('cancela y dispara el reembolso automatico cuando faltan mas de 1 hora', async () => {
      const { useCase, appointments, paymentPort } = buildUseCase(at('08:30'));

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'client-1' });

      expect(result.outcome).toBe('cancelled');
      expect(appointments.updateStatusCalls).toEqual([{ id: 'appt-1', status: 'cancelado' }]);
      // "sin aprobación manual": the refund is part of cancelling, not a
      // second step someone has to remember to trigger.
      expect(paymentPort.refundCalls).toEqual([{ paymentId: 'pay-1', amountCents: 500000 }]);
    });

    it('acepta exactamente en el limite: "hasta 1 hora antes" incluye la hora exacta', async () => {
      const { useCase } = buildUseCase(at('09:00'));

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'client-1' });

      expect(result.outcome).toBe('cancelled');
    });

    it('no intenta reembolso cuando el turno no tiene sena cobrada', async () => {
      const { useCase, paymentPort } = buildUseCase(
        at('08:30'),
        buildAppointment({ channel: 'telefonico', deposit: { kind: 'not_applicable' } }),
      );

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'client-1' });

      expect(result.outcome).toBe('cancelled');
      expect(paymentPort.refundCalls).toEqual([]);
    });
  });

  describe('Intento de cancelación fuera de la ventana permitida', () => {
    it('rechaza el autoservicio cuando falta menos de 1 hora, sin tocar el turno ni el dinero', async () => {
      const { useCase, appointments, paymentPort } = buildUseCase(at('09:30'));

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'client-1' });

      expect(result.outcome).toBe('too-late');
      expect(appointments.updateStatusCalls).toEqual([]);
      expect(paymentPort.refundCalls).toEqual([]);
    });

    it('informa el instante de corte, para que la web pueda explicar el rechazo', async () => {
      const { useCase } = buildUseCase(at('09:30'));

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'client-1' });

      // The cutoff is the appointment start minus the window — the same
      // instant the 2h reminder announces as the last chance to cancel.
      expect(result).toEqual({ outcome: 'too-late', cutoff: at('09:00') });
    });

    it('sigue rechazando despues de que el turno ya empezo', async () => {
      const { useCase, paymentPort } = buildUseCase(at('10:15'));

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'client-1' });

      expect(result.outcome).toBe('too-late');
      expect(paymentPort.refundCalls).toEqual([]);
    });
  });

  describe('El cliente solo actúa sobre sus propios datos', () => {
    it('rechaza cancelar el turno de otra cuenta', async () => {
      const { useCase, appointments, paymentPort } = buildUseCase(at('08:30'));

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'otro-cliente' });

      expect(result.outcome).toBe('not-yours');
      expect(appointments.updateStatusCalls).toEqual([]);
      expect(paymentPort.refundCalls).toEqual([]);
    });

    it('responde igual ante un turno inexistente que ante uno ajeno, para no revelar cuales existen', async () => {
      const { useCase } = buildUseCase(at('08:30'));

      const foreign = await useCase.execute({ appointmentId: 'appt-1', clientId: 'otro-cliente' });
      const missing = await useCase.execute({ appointmentId: 'no-existe', clientId: 'otro-cliente' });

      expect(missing).toEqual(foreign);
    });

    it('chequea la propiedad ANTES que la ventana: un turno ajeno fuera de ventana nunca revela su horario', async () => {
      // Reversing these two checks would let a prober tell "exists and starts
      // soon" (too-late) apart from "not yours" — a timing oracle over other
      // people's appointments.
      const { useCase } = buildUseCase(at('09:30'));

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'otro-cliente' });

      expect(result.outcome).toBe('not-yours');
    });
  });

  describe('estados no cancelables', () => {
    it('rechaza cancelar un turno que ya no esta reservado', async () => {
      const { useCase, paymentPort } = buildUseCase(
        at('08:30'),
        buildAppointment({
          status: 'cancelado',
          deposit: { kind: 'refunded', refundId: 'refund-1', amountCents: 500000 },
        }),
      );

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'client-1' });

      expect(result.outcome).toBe('not-cancellable');
      expect(paymentPort.refundCalls).toEqual([]);
    });
  });

  it('expone la ventana como constante, para que el recordatorio de 2h use el mismo numero', () => {
    expect(SELF_CANCEL_WINDOW_MINUTES).toBe(60);
  });
});
