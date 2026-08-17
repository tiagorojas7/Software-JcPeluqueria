import { BadRequestException, Body, ConflictException, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { CreateHold } from '@jc-barberia/application';
import { CreateHoldRequestSchema, type HoldResponse } from '@jc-barberia/contracts';
import { SlotUnavailableError, type Clock } from '@jc-barberia/domain';

import { Public } from '../access-control/decorators/public.decorator';
import { CLOCK } from './tokens';

/**
 * client-booking spec, "Exploración sin cuenta" + slot-hold "Creación del
 * hold" (task 2.8, reused unmodified here): a visitor claims a schedule
 * before ever identifying themselves. `clientId` is always `null` on
 * creation — the account only exists at confirmation (task 9.7/9.8). Time
 * travels as `calendarDate` + local `HH:mm`, same shape
 * `PhoneAppointmentController` uses, so `Clock.localTimeToUtc` remains the
 * only place a concrete instant is built.
 */
@Controller('holds')
export class HoldController {
  constructor(
    private readonly createHold: CreateHold,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Public()
  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown): Promise<HoldResponse> {
    const parsed = CreateHoldRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { barberId, serviceId, calendarDate, startTime, endTime } = parsed.data;

    try {
      const hold = await this.createHold.execute({
        id: crypto.randomUUID(),
        barberId,
        serviceId,
        clientId: null,
        channel: 'web',
        timeRange: {
          start: this.clock.localTimeToUtc(calendarDate, startTime),
          end: this.clock.localTimeToUtc(calendarDate, endTime),
        },
        searchWindow: this.clock.businessDayBounds(calendarDate),
      });
      return { holdId: hold.id, expiresAt: hold.holdExpiresAt.toISOString() };
    } catch (error) {
      // design.md's competing-clients diagram: a slot taken out from under
      // this request is an ordinary 409 with alternatives, never a 500 — the
      // same translation the EXCLUDE constraint already forces at the
      // repository boundary (SlotUnavailableError), just surfaced here.
      if (error instanceof SlotUnavailableError) {
        throw new ConflictException({
          message: 'El horario ya no está disponible',
          alternatives: error.alternatives.map((w) => ({ start: w.start.toISOString(), end: w.end.toISOString() })),
        });
      }
      throw error;
    }
  }
}
