import type { Hold, Clock } from '@jc-barberia/domain';

/**
 * Detects all reserved slots (holds with status 'reservado') belonging to a given
 * barber that fall within a specified time range. This is the first step of the
 * barber-absence-reassignment flow: when a barber is marked unavailable, we need
 * to know which clients are affected.
 */
export class MarkBarberAbsentUseCase {
  constructor(
    private readonly slots: Hold[],
    private readonly clock: Clock,
  ) {}

  async execute({
    barberId,
    timeRange,
  }: {
    readonly barberId: string;
    readonly timeRange: { readonly start: Date; readonly end: Date };
  }): Promise<Hold[]> {
    return this.slots.filter(
      (slot) =>
        slot.barberId === barberId &&
        slot.timeRange.start >= timeRange.start &&
        slot.timeRange.end <= timeRange.end,
    );
  }
}