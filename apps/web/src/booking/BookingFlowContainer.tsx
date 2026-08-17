import type { AvailabilitySlot, HoldResponse } from '@jc-barberia/contracts';

import { AvailabilityPicker } from './AvailabilityPicker';
import { HoldCountdown } from './HoldCountdown';

export interface BookingFlowContainerProps {
  readonly slots: readonly AvailabilitySlot[];
  /** `null` until a hold has been created for the slot the visitor picked. */
  readonly hold: HoldResponse | null;
  readonly nowMs: number;
  readonly onSelectSlot: (slot: AvailabilitySlot) => void;
}

/**
 * The public booking flow's step switch (tasks 9.3/9.4): while there is no
 * hold yet, the visitor sees `AvailabilityPicker`; once `onSelectSlot`'s
 * caller has created one (`POST /holds`, `HoldController`), this switches to
 * `HoldCountdown`. Neither creating the hold nor fetching availability
 * happens in here — same container/presentational split as `DayBoard`'s
 * containers: this component only decides WHICH step to render, from props
 * a page-level caller already resolved.
 */
export function BookingFlowContainer({ slots, hold, nowMs, onSelectSlot }: BookingFlowContainerProps) {
  if (hold) {
    return <HoldCountdown expiresAt={hold.expiresAt} nowMs={nowMs} />;
  }
  return <AvailabilityPicker slots={slots} onSelectSlot={onSelectSlot} />;
}
