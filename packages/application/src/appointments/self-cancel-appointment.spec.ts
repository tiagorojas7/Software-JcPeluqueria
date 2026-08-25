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

  // Cambio de regla pedido por el dueño: fuera de la ventana el cliente IGUAL
  // puede cancelar; lo que pierde es la seña, no la posibilidad. Antes se le
  // negaba y se lo mandaba a contactar al local, lo que dejaba el cupo tomado
  // por un turno al que nadie iba a ir — el peor de los dos mundos para la
  // barberia.
  describe('Cancelación fuera de la ventana: se permite, pero sin devolución', () => {
    it('cancela y libera el cupo aunque falte menos de 1 hora', async () => {
      const { useCase, appointments } = buildUseCase(at('09:30'));

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'client-1' });

      expect(result.outcome).toBe('cancelled');
      expect(appointments.updateStatusCalls).toEqual([{ id: 'appt-1', status: 'cancelado' }]);
    });

    it('pierde la seña en vez de reembolsarla, sin llamar a la pasarela', async () => {
      const { useCase, paymentPort } = buildUseCase(at('09:30'));

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'client-1' });

      if (result.outcome !== 'cancelled') {
        throw new Error(`esperaba cancelled, llego ${result.outcome}`);
      }
      expect(result.refund).toBe('forfeited');
      expect(result.appointment.deposit).toEqual({ kind: 'forfeited', amountCents: 500000 });
      // Perder una seña no mueve plata: no hay nada que pedirle a MercadoPago.
      expect(paymentPort.refundCalls).toEqual([]);
    });

    it('tambien despues de que el turno ya empezo', async () => {
      const { useCase, paymentPort } = buildUseCase(at('10:15'));

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'client-1' });

      expect(result.outcome).toBe('cancelled');
      expect(paymentPort.refundCalls).toEqual([]);
    });

    it('dentro de la ventana informa que la sena se devuelve', async () => {
      const { useCase } = buildUseCase(at('08:30'));

      const result = await useCase.execute({ appointmentId: 'appt-1', clientId: 'client-1' });

      if (result.outcome !== 'cancelled') {
        throw new Error(`esperaba cancelled, llego ${result.outcome}`);
      }
      expect(result.refund).toBe('refunded');
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
