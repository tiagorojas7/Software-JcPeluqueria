import {
  type Appointment,
  type AppointmentRepository,
} from '@jc-barberia/domain';
import { ListBarberAppointmentsUseCase } from './barber-appointments';
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeAppointmentRepository } from '@jc-barberia/domain';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2025-05-15', time);

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'telefonico',
    timeRange: { start: at('10:00'), end: at('10:30') },
    status: 'reservado' as const,
    deposit: { kind: 'not_applicable' },
    ...overrides,
  };
}

describe('ListBarberAppointmentsUseCase (11.1) — listado de turnos del barbero con paginación y filtros', () => {
  it('lists appointments for a specific barber with status filter', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment({ status: 'reservado' }));
    appointments.seed(buildAppointment({ status: 'realizado' }));
    appointments.seed(buildAppointment({ status: 'cancelado' }));
    const useCase = new ListBarberAppointmentsUseCase(appointments);

    const result = await useCase.execute({ barberId: 'barber-1', status: 'reservado' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe('reservado');
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
  });

  it('filters by date range', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildAppointment({ status: 'reservado' }));
    appointments.seed(buildAppointment({ status: 'reservado' }));
    appointments.seed(buildAppointment({ status: 'realizado' }));
    const useCase = new ListBarberAppointmentsUseCase(appointments);

    const result = await useCase.execute({
      barberId: 'barber-1',
      startDate: '2025-05-15',
      endDate: '2025-05-15',
    });

    expect(result.items).toHaveLength(2);
  });

  it('returns empty list when barber has no appointments', async () => {
    const appointments = new FakeAppointmentRepository();
    const useCase = new ListBarberAppointmentsUseCase(appointments);

    const result = await useCase.execute({ barberId: 'barber-1' });

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});