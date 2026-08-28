import {
  FakeAppointmentRepository,
  FakeBarberRepository,
  FakeClock,
  FakeServiceRepository,
  type Appointment,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ListOwnAppointmentsUseCase } from './list-own-appointments';

// cablear-el-mvp C.3 RED — derived from specs/client-booking/spec.md's "El
// cliente solo actúa sobre sus propios datos": the authenticated client
// (session-resolved `clientId`, never a body param — same posture
// `SelfCancelAppointmentUseCase` already takes) must see exactly their own
// appointments and nobody else's.

// Instants come off FakeClock, never `new Date(...)` — the ESLint clock rule
// covers tests too.
const clock = new FakeClock();

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'web',
    timeRange: {
      start: clock.parseInstant('2026-09-01T10:00:00.000Z'),
      end: clock.parseInstant('2026-09-01T10:30:00.000Z'),
    },
    status: 'reservado',
    deposit: { kind: 'settled', paymentId: 'pay-1', amountCents: 500000 },
    ...overrides,
  };
}

describe('ListOwnAppointmentsUseCase (C.3)', () => {
  it('devuelve unicamente los turnos del cliente autenticado', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment({ id: 'mine-1', clientId: 'client-1' }));
    appointments.seed(buildAppointment({ id: 'mine-2', clientId: 'client-1', status: 'cancelado' }));
    appointments.seed(buildAppointment({ id: 'other-1', clientId: 'otro-cliente' }));
    const useCase = new ListOwnAppointmentsUseCase(appointments, new FakeBarberRepository(), new FakeServiceRepository());

    const result = await useCase.execute({ clientId: 'client-1' });

    expect(result.map((a) => a.id).sort()).toEqual(['mine-1', 'mine-2']);
  });

  it('devuelve una lista vacia para un cliente sin turnos, nunca un error', async () => {
    const appointments = new FakeAppointmentRepository();
    const useCase = new ListOwnAppointmentsUseCase(appointments, new FakeBarberRepository(), new FakeServiceRepository());

    const result = await useCase.execute({ clientId: 'client-sin-turnos' });

    expect(result).toEqual([]);
  });

  // docs/HUECOS-BACKEND.md #7: "Mi cuenta" recibia `barberId` y `serviceId`
  // en crudo. Un uuid no se puede mostrar, asi que el cliente veia una
  // fecha, una hora y un estado — nunca QUE reservo ni CON QUIEN. Es la
  // pantalla donde decide si cancelar, y cancelar el turno equivocado cuesta
  // la senia.
  describe('nombres del servicio y del barbero (HUECOS #7)', () => {
    async function useCaseWithCatalogues() {
      const appointments = new FakeAppointmentRepository();
      const barbers = new FakeBarberRepository();
      const services = new FakeServiceRepository();
      await barbers.create({ id: 'barber-1', name: 'Cristian Gómez', active: true, permanentLeave: false });
      await services.create({
        id: 'service-1',
        name: 'Corte + Barba',
        durationMinutes: 45,
        priceCents: 1_200_000,
      });
      return { appointments, barbers, services };
    }

    it('resuelve el nombre del servicio y del barbero de cada turno', async () => {
      const { appointments, barbers, services } = await useCaseWithCatalogues();
      appointments.seed(buildAppointment({ id: 'mine-1', clientId: 'client-1' }));
      const useCase = new ListOwnAppointmentsUseCase(appointments, barbers, services);

      const [turno] = await useCase.execute({ clientId: 'client-1' });

      expect(turno?.serviceName).toBe('Corte + Barba');
      expect(turno?.barberName).toBe('Cristian Gómez');
    });

    // Un barbero dado de baja sigue teniendo turnos pasados a su nombre: la
    // lista es historial, y un hueco donde iba un nombre se lee como un bug.
    it('no deja el turno sin nombre cuando el barbero ya no esta en el catalogo', async () => {
      const { appointments, barbers, services } = await useCaseWithCatalogues();
      appointments.seed(buildAppointment({ id: 'viejo-1', clientId: 'client-1', barberId: 'se-fue' }));
      const useCase = new ListOwnAppointmentsUseCase(appointments, barbers, services);

      const [turno] = await useCase.execute({ clientId: 'client-1' });

      expect(turno?.barberName).toBeTruthy();
      expect(turno?.serviceName).toBe('Corte + Barba');
    });
  });
});
