import type { TimeWindow } from '../availability';

/**
 * `any-day`: an ordinary `client-booking` hold — no restriction, the client
 * browses and picks freely. `same-day`: a `barber-absence-reassignment`
 * offer — the shop owes the client a same-day resolution, so an alternative
 * on another day is never automatically offered.
 */
export type NearestAvailableScope = 'any-day' | 'same-day';

/** A window already known to be free, for at least the needed duration. */
export interface AvailableCandidate {
  /** ISO calendar date (`YYYY-MM-DD`) the window falls on, shop-local. */
  readonly date: string;
  readonly window: TimeWindow;
}

export interface FindNearestAvailableInput {
  readonly candidates: readonly AvailableCandidate[];
  /** Calendar date the hold that failed re-validation was originally for. */
  readonly originDate: string;
  /** The failed hold's original start instant — distance is measured from here. */
  readonly referenceInstant: Date;
  readonly scope: NearestAvailableScope;
}

/**
 * Picks the candidate closest to `referenceInstant`. With `scope:
 * 'same-day'`, a candidate on a different day than `originDate` is never
 * considered, even when it is numerically closer — that restriction is
 * specific to `barber-absence-reassignment` (spec: slot-hold, "Re-validación
 * — mismo día"). `scope: 'any-day'` considers every candidate given.
 */
export function findNearestAvailable(input: FindNearestAvailableInput): AvailableCandidate | null {
  const scoped =
    input.scope === 'same-day'
      ? input.candidates.filter((candidate) => candidate.date === input.originDate)
      : input.candidates;

  return scoped.reduce<AvailableCandidate | null>((nearest, candidate) => {
    if (!nearest) {
      return candidate;
    }
    const candidateDistance = Math.abs(
      candidate.window.start.getTime() - input.referenceInstant.getTime(),
    );
    const nearestDistance = Math.abs(nearest.window.start.getTime() - input.referenceInstant.getTime());
    return candidateDistance < nearestDistance ? candidate : nearest;
  }, null);
}
