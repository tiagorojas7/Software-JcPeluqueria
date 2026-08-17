import {
  HOLD_DURATION_MINUTES,
  type Clock,
  type Hold,
  type HoldRepository,
  type OccupancyChannel,
  type TimeWindow,
} from '@jc-barberia/domain';
import { CreateHold } from '@jc-barberia/application';

export interface SelectSlotInput {
  readonly serviceId: string;
  readonly barberId: string;
  readonly slotStart: string;
  readonly slotEnd: string;
  readonly date: string;
}

export interface SelectSlotOutput {
  readonly holdId: string;
  readonly expiresAt: Date;
  readonly hold: Hold;
}

export class SelectSlotUseCase {
  constructor(
    private readonly createHold: CreateHold,
    private readonly clock: Clock,
    private readonly holds: HoldRepository,
  ) {}

  async execute(input: SelectSlotInput): Promise<SelectSlotOutput> {
    const holdId = crypto.randomUUID();
    const timeRange: TimeWindow = {
      start: this.clock.localTimeToUtc(input.date, input.slotStart),
      end: this.clock.localTimeToUtc(input.date, input.slotEnd),
    };

    const hold: Hold = {
      id: holdId,
      barberId: input.barberId,
      serviceId: input.serviceId,
      clientId: null,
      channel: 'web',
      timeRange,
      holdExpiresAt: this.clock.addMinutes(this.clock.now(), HOLD_DURATION_MINUTES),
    };

    await this.holds.create(hold, { start: timeRange.start, end: timeRange.end });

    const expiresAt = this.clock.addMinutes(this.clock.now(), HOLD_DURATION_MINUTES);

    return { holdId, expiresAt, hold };
  }
}