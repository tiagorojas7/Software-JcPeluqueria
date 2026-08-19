import { FakeAppointmentRepository, type Appointment } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ListOwnAppointmentsUseCase } from './list-own-appointments';

// cablear-el-mvp C.3 RED — derived from specs/client-booking/spec.md's "El
// cliente solo actúa sobre sus propios datos": the authenticated client
// (session-resolved `clientId`, never a body param — same posture
// `SelfCancelAppointmentUseCase` already takes) must see exactly their own
// appointments and nobody else's.

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'web',
    timeRange: { start: new Date('2026-09-01T10:00:00.000Z'), end: new Date('2026-09-01T10:30:00.000Z') },
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
    const useCase = new ListOwnAppointmentsUseCase(appointments);

    const result = await useCase.execute({ clientId: 'client-1' });

    expect(result.map((a) => a.id).sort()).toEqual(['mine-1', 'mine-2']);
  });

  it('devuelve una lista vacia para un cliente sin turnos, nunca un error', async () => {
    const appointments = new FakeAppointmentRepository();
    const useCase = new ListOwnAppointmentsUseCase(appointments);

    const result = await useCase.execute({ clientId: 'client-sin-turnos' });

    expect(result).toEqual([]);
  });
});
