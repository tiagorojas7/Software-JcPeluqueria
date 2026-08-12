import {
  findNearestAvailable,
  type AvailableCandidate,
  type Hold,
  type HoldRepository,
  type NearestAvailableScope,
  type TimeWindow,
} from '@jc-barberia/domain';

import type { CreateHold } from './create-hold';

export interface ConfirmHoldInput {
  readonly originalHold: Hold;
  /** Calendar date the original hold was for — bounds the `same-day` scope. */
  readonly originDate: string;
  readonly scope: NearestAvailableScope;
  /** Pre-computed free windows to offer if re-validation fails. */
  readonly candidates: readonly AvailableCandidate[];
  readonly reofferedHoldId: string;
  readonly reofferedSearchWindow: TimeWindow;
}

export type ConfirmHoldResult =
  | { readonly outcome: 'confirmed'; readonly hold: Hold }
  | { readonly outcome: 'reoffered'; readonly hold: Hold };

/**
 * Re-validates immediately before confirming. The hold transitions
 * atomically (`held` -> `reservado`) inside `HoldRepository.confirm` — this
 * use case never issues a second `create`/insert to "replace" a hold.
 *
 * When re-validation fails, it offers the nearest candidate allowed by
 * `scope` instead of failing outright, and claims a fresh 15-minute hold on
 * it via `CreateHold` — never an ad hoc insert.
 */
export class ConfirmHold {
  constructor(
    private readonly holds: HoldRepository,
    private readonly createHold: CreateHold,
  ) {}

  async execute(input: ConfirmHoldInput): Promise<ConfirmHoldResult> {
    const confirmed = await this.holds.confirm(input.originalHold.id);
    if (confirmed) {
      return { outcome: 'confirmed', hold: input.originalHold };
    }

    const nearest = findNearestAvailable({
      candidates: input.candidates,
      originDate: input.originDate,
      referenceInstant: input.originalHold.timeRange.start,
      scope: input.scope,
    });
    if (!nearest) {
      // The "nothing available" branch (tasks 2.16/2.17) replaces this.
      throw new Error('ConfirmHold: no candidate available — not implemented yet (see task 2.16)');
    }

    const hold = await this.createHold.execute({
      id: input.reofferedHoldId,
      barberId: input.originalHold.barberId,
      serviceId: input.originalHold.serviceId,
      clientId: input.originalHold.clientId,
      channel: input.originalHold.channel,
      timeRange: nearest.window,
      searchWindow: input.reofferedSearchWindow,
    });
    return { outcome: 'reoffered', hold };
  }
}
