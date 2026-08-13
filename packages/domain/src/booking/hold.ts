import type { TimeWindow } from '../availability';

/** How the occupancy entered the system. */
export type OccupancyChannel = 'web' | 'telefonico' | 'walk_in';

/**
 * A provisional claim over one barber's time. Physically it is the same row
 * as the appointment it may become — confirming it is a status transition,
 * never a second insert.
 */
export interface Hold {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  /** Null until the client identifies themselves at the end of the flow. */
  readonly clientId: string | null;
  readonly channel: OccupancyChannel;
  readonly timeRange: TimeWindow;
  readonly holdExpiresAt: Date;
}

/**
 * Somebody else already holds or booked that range. `alternatives` are the
 * ranges still free inside the window the caller asked to search, so the
 * client is offered something concrete instead of a bare failure.
 */
export class SlotUnavailableError extends Error {
  constructor(readonly alternatives: readonly TimeWindow[]) {
    super('The selected slot is no longer available');
    this.name = 'SlotUnavailableError';
  }
}

export interface HoldRepository {
  /**
   * Claims the range for the barber. Throws `SlotUnavailableError` when the
   * range is already taken, carrying what is still free inside
   * `searchWindow` (normally the barber's working window for that day).
   */
  create(hold: Hold, searchWindow: TimeWindow): Promise<void>;
}
