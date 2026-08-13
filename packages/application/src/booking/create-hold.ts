import {
  HOLD_DURATION_MINUTES,
  type Clock,
  type Hold,
  type HoldRepository,
  type OccupancyChannel,
  type TimeWindow,
} from '@jc-barberia/domain';

export interface CreateHoldInput {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  readonly clientId: string | null;
  readonly channel: OccupancyChannel;
  readonly timeRange: TimeWindow;
  /** Where alternatives are searched if the slot turns out to be taken. */
  readonly searchWindow: TimeWindow;
}

/**
 * Claims a slot for exactly `HOLD_DURATION_MINUTES`. The duration is a
 * business rule this use case enforces via the injected `Clock` — callers
 * never supply `holdExpiresAt` themselves, and `HoldRepository.create` only
 * knows how to persist an already-formed `Hold`.
 */
export class CreateHold {
  constructor(
    private readonly holds: HoldRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateHoldInput): Promise<Hold> {
    const hold: Hold = {
      id: input.id,
      barberId: input.barberId,
      serviceId: input.serviceId,
      clientId: input.clientId,
      channel: input.channel,
      timeRange: input.timeRange,
      holdExpiresAt: this.clock.addMinutes(this.clock.now(), HOLD_DURATION_MINUTES),
    };
    await this.holds.create(hold, input.searchWindow);
    return hold;
  }
}
