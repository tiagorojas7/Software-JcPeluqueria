import { Controller, Inject, Post, Param } from '@nestjs/common';
import { CLOCK, CONFIRM_ABSENCE_HOLD_REPOSITORY } from './tokens';

@Controller()
export class ConfirmAbsenceController {
  constructor(
    @Inject(CLOCK) private readonly clock: import('domain').Clock,
    @Inject(CONFIRM_ABSENCE_HOLD_REPOSITORY)
    private readonly holdRepo: import('infrastructure').DrizzleHoldRepository,
  ) {}

  @Post('admin/appointments/:id/confirm-absence')
  async confirmAbsence(
    @Param('id') id: string,
  ): Promise<{ holdId: string; originOccupancyId: string }> {
    const holdId = crypto.randomUUID();
    const now = this.clock.now();
    const holdExpiresAt = this.clock.addMinutes(now, 15);

    await this.holdRepo.create(
      {
        id: holdId,
        barberId: '',
        serviceId: '',
        clientId: null,
        channel: 'telefonico',
        timeRange: { start: now, end: now },
        holdExpiresAt,
        originOccupancyId: id,
      },
      { start: now, end: now },
    );

    return { holdId, originOccupancyId: id };
  }
}