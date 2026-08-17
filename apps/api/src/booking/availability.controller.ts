import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { GetPublicAvailabilityUseCase } from '@jc-barberia/application';
import { GetAvailabilityQuerySchema, type AvailabilityResponse } from '@jc-barberia/contracts';

import { Public } from '../access-control/decorators/public.decorator';

/**
 * client-booking spec, "Exploración sin cuenta" (task 9.1/9.2): the FIRST
 * public, unauthenticated endpoint this application ships — `@Public()` is
 * not an oversight here, it is the literal requirement. No `ActorContext`,
 * no permission check: an anonymous visitor is the only caller.
 */
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly getAvailability: GetPublicAvailabilityUseCase) {}

  @Public()
  @Get()
  async list(@Query() query: unknown): Promise<AvailabilityResponse> {
    const parsed = GetAvailabilityQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    const { slots } = await this.getAvailability.execute(parsed.data);
    return {
      slots: slots.map((slot) => ({ startsAt: slot.start.toISOString(), endsAt: slot.end.toISOString() })),
    };
  }
}
