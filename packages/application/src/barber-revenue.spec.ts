import type { Appointment, AppointmentRepository, Service, ServiceRepository } from '@jc-barberia/domain';
import { FakeAppointmentRepository, FakeServiceRepository } from '@jc-barberia/domain';
import { GetOwnRevenueUseCase } from './barber-revenue';
import { describe, expect, it } from 'vitest';

describe('GetOwnRevenueUseCase (11.7/11.8) — facturación teórica por precio de lista', () => {
  it('calculates revenue at list price from the barber\'s realized turns', async () => {
    const appointments = new FakeAppointmentRepository();
    const services = new FakeServiceRepository();

    services.seed({ id: 's-1', name: 'Corte', priceCents: 5000 });
    services.seed({ id: 's-2', name: 'Barba', priceCents: 2000 });

    appointments.seed({
      id: 'appt-1',
      barberId: 'barber-1',
      serviceId: 's-1',
      clientId: 'client-1',
      channel: 'telefonico',
      timeRange: { start: new Date('2025-05-15T10:00:00Z'), end: new Date('2025-05-15T10:30:00Z') },
      status: 'realizado' as const,
    });
    appointments.seed({
      id: 'appt-2',
      barberId: 'barber-1',
      serviceId: 's-2',
      clientId: 'client-2',
      channel: 'telefonico',
      timeRange: { start: new Date('2025-05-15T11:00:00Z'), end: new Date('2025-05-15T11:30:00Z') },
      status: 'reservado' as const,
    });
    appointments.seed({
      id: 'appt-3',
      barberId: 'barber-1',
      serviceId: 's-1',
      clientId: 'client-3',
      channel: 'telefonico',
      timeRange: { start: new Date('2025-05-15T14:00:00Z'), end: new Date('2025-05-15T14:30:00Z') },
      status: 'realizado' as const,
    });

    const useCase = new GetOwnRevenueUseCase(appointments, services);

    const result = await useCase.execute('barber-1');

    expect(result.totalTurns).toBe(3);
    expect(result.realizedTurns).toBe(2);
    expect(result.revenueCents).toBe(10000);
    expect(result.revenueLabel).toBe('2 cortes realizados');
  });

  it('returns zeros for a barber with no realized turns', async () => {
    const appointments = new FakeAppointmentRepository();
    const services = new FakeServiceRepository();

    services.seed({ id: 's-1', name: 'Corte', priceCents: 5000 });

    appointments.seed({
      id: 'appt-1',
      barberId: 'barber-1',
      serviceId: 's-1',
      clientId: 'client-1',
      channel: 'telefonico',
      timeRange: { start: new Date('2025-05-15T10:00:00Z'), end: new Date('2025-05-15T10:30:00Z') },
      status: 'reservado' as const,
    });

    const useCase = new GetOwnRevenueUseCase(appointments, services);

    const result = await useCase.execute('barber-1');

    expect(result.totalTurns).toBe(1);
    expect(result.realizedTurns).toBe(0);
    expect(result.revenueCents).toBe(0);
    expect(result.revenueLabel).toBe('0 cortes realizados');
  });

  it('only counts the specified barber\'s revenue, not other barbers\'', async () => {
    const appointments = new FakeAppointmentRepository();
    const services = new FakeServiceRepository();

    services.seed({ id: 's-1', name: 'Corte', priceCents: 5000 });

    appointments.seed({
      id: 'appt-1',
      barberId: 'barber-1',
      serviceId: 's-1',
      clientId: 'client-1',
      channel: 'telefonico',
      timeRange: { start: new Date('2025-05-15T10:00:00Z'), end: new Date('2025-05-15T10:30:00Z') },
      status: 'realizado' as const,
    });
    appointments.seed({
      id: 'appt-2',
      barberId: 'barber-2',
      serviceId: 's-1',
      clientId: 'client-2',
      channel: 'telefonico',
      timeRange: { start: new Date('2025-05-15T11:00:00Z'), end: new Date('2025-05-15T11:30:00Z') },
      status: 'realizado' as const,
    });

    const useCase = new GetOwnRevenueUseCase(appointments, services);

    const result = await useCase.execute('barber-1');

    expect(result.totalTurns).toBe(1);
    expect(result.realizedTurns).toBe(1);
    expect(result.revenueCents).toBe(5000);
    expect(result.revenueLabel).toBe('1 corte realizado');
  });
});