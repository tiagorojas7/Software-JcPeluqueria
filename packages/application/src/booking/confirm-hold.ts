import type { Hold, HoldRepository } from '@jc-barberia/domain';

export interface ConfirmHoldInput {
  readonly originalHold: Hold;
}

export type ConfirmHoldResult =
  | { readonly outcome: 'confirmed'; readonly hold: Hold }
  | { readonly outcome: 'expired' };

/**
 * Re-validates immediately before confirming. The hold transitions
 * atomically (`held` -> `reservado`) inside `HoldRepository.confirm` — this
 * use case never issues a second `create`/insert to "replace" a hold.
 */
export class ConfirmHold {
  constructor(private readonly holds: HoldRepository) {}

  async execute(input: ConfirmHoldInput): Promise<ConfirmHoldResult> {
    const confirmed = await this.holds.confirm(input.originalHold.id);
    return confirmed ? { outcome: 'confirmed', hold: input.originalHold } : { outcome: 'expired' };
  }
}
