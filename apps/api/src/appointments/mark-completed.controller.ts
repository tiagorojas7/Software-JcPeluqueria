import { BadRequestException, Controller, Inject, Post, Param } from '@nestjs/common';
import { MARK_COMPLETED_REPOSITORY } from './mark-completed.token';
import type { Appointment } from '@jc-barberia/domain';
import { AdminMarkCompletedUseCase } from '@jc-barberia/application';
import { AppointmentNotFoundError } from '@jc-barberia/domain';

@Controller()
export class MarkCompletedController {
  constructor(
    @Inject(MARK_COMPLETED_REPOSITORY)
    private readonly adminMarkCompleted: AdminMarkCompletedUseCase,
  ) {}

  @Post('admin/appointments/:id/mark-completed')
  async markCompleted(@Param('id') id: string): Promise<Appointment> {
    try {
      const appointment = await this.adminMarkCompleted.execute(id);
      return appointment;
    } catch (error) {
      if (error instanceof AppointmentNotFoundError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}