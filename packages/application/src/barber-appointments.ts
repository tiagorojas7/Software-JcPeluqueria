import {
  type Appointment,
  type AppointmentRepository,
} from '@jc-barberia/domain';

export class ListBarberAppointmentsUseCase {
  constructor(private readonly appointments: AppointmentRepository) {}

  async execute({
    barberId,
    status,
    startDate,
    endDate,
  }: {
    barberId: string;
    status?: 'reservado' | 'realizado' | 'cancelado';
    startDate?: string;
    endDate?: string;
  }) {
    return { items: [], total: 0, page: 1, pageSize: 10 };
  }
}