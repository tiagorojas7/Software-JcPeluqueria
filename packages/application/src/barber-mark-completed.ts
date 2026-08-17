import type { Appointment, AppointmentRepository } from '@jc-barberia/domain';
import { FakeAppointmentRepository } from '@jc-barberia/domain';

export class MarkCompletedUseCase {
  constructor(private readonly appointments: AppointmentRepository) {}

  async execute({ appointmentId, barberId }: { appointmentId: string; barberId: string }): Promise<boolean> {
    const appointment = await this.appointments.findById(appointmentId);
    if (!appointment || appointment.barberId !== barberId) {
      return false;
    }
    if (appointment.status !== 'reservado') {
      return false;
    }
    await this.appointments.updateStatus(appointmentId, 'realizado');
    return true;
  }
}