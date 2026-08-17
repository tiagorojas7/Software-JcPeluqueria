import type { AvailabilitySlot, ConfirmReservationRequest, HoldResponse } from '@jc-barberia/contracts';

import { AccountForm } from './AccountForm';
import { AvailabilityPicker } from './AvailabilityPicker';
import { HoldCountdown } from './HoldCountdown';

export interface BookingFlowContainerProps {
  readonly slots: readonly AvailabilitySlot[];
  /** `null` until a hold has been created for the slot the visitor picked. */
  readonly hold: HoldResponse | null;
  readonly nowMs: number;
  readonly onSelectSlot: (slot: AvailabilitySlot) => void;
  readonly onConfirmReservation: (input: ConfirmReservationRequest) => void;
}

/**
 * The public booking flow's step switch (tasks 9.3/9.4/9.5/9.6): while there
 * is no hold yet, the visitor sees `AvailabilityPicker`; once
 * `onSelectSlot`'s caller has created one (`POST /holds`, `HoldController`),
 * this shows `HoldCountdown` TOGETHER with `AccountForm` — the countdown
 * keeps running while the visitor fills the account form (client-booking:
 * "Cuenta sin contraseña creada al final del flujo"), never one replacing
 * the other. Neither creating the hold nor confirming the reservation
 * happens in here — same container/presentational split as `DayBoard`'s
 * containers: this component only decides WHICH step(s) to render, from
 * props a page-level caller already resolved.
 */
export function BookingFlowContainer({
  slots,
  hold,
  nowMs,
  onSelectSlot,
  onConfirmReservation,
}: BookingFlowContainerProps) {
  if (hold) {
    return (
      <div>
        <HoldCountdown expiresAt={hold.expiresAt} nowMs={nowMs} />
        <AccountForm holdId={hold.holdId} onSubmit={onConfirmReservation} />
      </div>
    );
  }
  return <AvailabilityPicker slots={slots} onSelectSlot={onSelectSlot} />;
}
