import type { Appointment, AppointmentRepository } from '@jc-barberia/domain';
import { FakeAppointmentRepository } from '@jc-barberia/domain';
import { MarkCompletedUseCase } from './barber-mark-completed';
import { describe, expect, it } from 'vitest';

describe('MarkCompletedUseCase (11.11) — resolución de los turnos propios', () => {
  it('allows barber to mark own turn as realizado', async () => {
    const appointments = new FakeAppointmentRepository();

    appointments.seed({
      id: 'appt-1',
      barberId: 'barber-1',
      serviceId: 'service-1',
      clientId: 'client-1',
      channel: 'telefonico',
      timeRange: { start: new Date('2025-05-15T10:00:00Z'), end: new Date('2025-05-15T10:30:00Z') },
      status: 'reservado' as const,
    });

    const useCase = new MarkCompletedUseCase(appointments);

    const result = await useCase.execute({ appointmentId: 'appt-1', barberId: 'barber-1' });

    expect(result).toBe(true);
    const updated = await appointments.findById('appt-1');
    expect(updated?.status).toBe('realizado');
  });

  it('rejects marking a colleague\'s turn as realizado', async () => {
    const appointments = new FakeAppointmentRepository();

    appointments.seed({
      id: 'appt-1',
      barberId: 'barber-2',
      serviceId: 'service-1',
      clientId: 'client-1',
      channel: 'telefonico',
      timeRange: { start: new Date('2025-05-15T10:00:00Z'), end: new Date('2025-05-15T10:30:00Z') },
      status: 'reservado' as const,
    });

    const useCase = new MarkCompletedUseCase(appointments);

    const result = await useCase.execute({ appointmentId: 'appt-1', barberId: 'barber-1' });

    expect(result).toBe(false);
  });

  it('rejects marking a turn that is not reservado', async () => {
    const appointments = new FakeAppointmentRepository();

    appointments.seed({
      id: 'appt-1',
      barberId: 'barber-1',
      serviceId: 'service-1',
      clientId: 'client-1',
      channel: 'telefonico',
      timeRange: { start: new Date('2025-05-15T10:00:00Z'), end: new Date('2025-05-15T10:30:00Z') },
      status: 'realizado' as const,
    });

    const useCase = new MarkCompletedUseCase(appointments);

    const result = await useCase.execute({ appointmentId: 'appt-1', barberId: 'barber-1' });

    expect(result).toBe(false);
  });

  it('rejects marking a turn without matching barberId', async () => {
    const appointments = new FakeAppointmentRepository();

    appointments.seed({
      id: 'appt-1',
      barberId: 'barber-2',
      serviceId: 'service-1',
      clientId: 'client-1',
      channel: 'telefonico',
      timeRange: { start: new Date('2025-05-15T10:00:00Z'), end: new Date('2025-05-15T10:30:00Z') },
      status: 'reservado' as const,
    });

    const useCase = new MarkCompletedUseCase(appointments);

    const result = await useCase.execute({ appointmentId: 'appt-1', barberId: 'barber-1' });

    expect(result).toBe(false);
  });
});