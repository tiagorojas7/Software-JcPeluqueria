import { BadRequestException, Clock, Controller, Inject, Post, Param } from '@nestjs/common';
import { CLOCK } from './tokens';
import type { Appointment } from '@jc-barberia/domain';
import { WALK_IN_REPOSITORY } from './walk-in.token';
import { CreateWalkInUseCase } from '@jc-barberia/application';
import { AppointmentNotFoundError } from '@jc-barberia/domain';

@Controller()
export class WalkInController {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(WALK_IN_REPOSITORY)
    private readonly createWalkIn: CreateWalkInUseCase,
  ) {}

  @Post('admin/appointments/:id/walk-in')
  async walkIn(@Param('id') _id: string): Promise<Appointment> {
    try {
      const walkIn = await this.createWalkIn.execute({
        id: crypto.randomUUID(),
        barberId: '',
        serviceId: '',
        clientId: null,
        channel: 'walk_in' as const,
        timeRange: { start: this.clock.now(), end: this.clock.now() },
        searchWindow: { start: this.clock.now(), end: this.clock.now() },
      });
      return walkIn;
    } catch (error) {
      if (error instanceof AppointmentNotFoundError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}