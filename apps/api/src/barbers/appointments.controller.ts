import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../access-control/guards/jwt-auth.guard';
import { RolesGuard } from '../access-control/guards/roles.guard';
import { RequiresPermission } from '../access-control/decorators/requires-permission.decorator';
import { ListBarberAppointmentsUseCase } from '@jc-barberia/application';
import type { Appointment } from '@jc-barberia/domain';

type AppointmentResponse = {
  id: string;
  status: string;
  barberId: string;
  serviceId: string;
  clientId: string;
  startsAt: string;
  endsAt: string;
};

@Controller('barbers/me')
export class BarberController {
  constructor(
    private readonly listBarberAppointments: ListBarberAppointmentsUseCase,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequiresPermission('barber:view:appointments')
  @Get('appointments')
  async appointments(
    @Query('status') status?: 'reservado' | 'realizado' | 'cancelado',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<AppointmentResponse[]> {
    const { items } = await this.listBarberAppointments.execute({
      barberId: 'current-user-id',
      status,
      startDate,
      endDate,
    });

    return items.map((appt) => ({
      id: appt.id,
      status: appt.status,
      barberId: appt.barberId,
      serviceId: appt.serviceId,
      clientId: appt.clientId,
      startsAt: appt.timeRange.start.toISOString(),
      endsAt: appt.timeRange.end.toISOString(),
    }));
  }
}