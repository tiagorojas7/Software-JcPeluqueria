import type { TimeWindow } from '../availability';

/** Every hold is provisional for exactly this long before it lapses. */
export const HOLD_DURATION_MINUTES = 15;

/** How the occupancy entered the system. */
export type OccupancyChannel = 'web' | 'telefonico' | 'walk_in';

/**
 * A provisional claim over one barber's time. Physically it is the same row
 * as the appointment it may become — confirming it is a status transition,
 * never a second insert.
 *
 * `originOccupancyId` connects this hold to the original slot occupancy row
 * (e.g. the turn it replaces in a barber-absence-reassignment flow). Null when
 * the hold is created through the ordinary client-booking flow.
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
  /** Id of the original slot occupancy row this hold replaces. */
  readonly originOccupancyId: string | null;
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

  /**
   * Atomically re-validates and confirms — a status transition on the same
   * row, never a second `create`/insert. Returns `false` when nothing was
   * updated: the hold expired, or something else already consumed it. The
   * caller must treat that as a failed re-validation, not throw.
   */
  confirm(holdId: string): Promise<boolean>;
}
