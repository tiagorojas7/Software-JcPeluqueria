import type { DayBoardResponse, SlotAction } from '@jc-barberia/contracts';

import { DayBoard } from './DayBoard';

export interface BarberDayBoardContainerProps {
  readonly dayBoard: DayBoardResponse;
  /** The authenticated barber's own id — resolved by the page from the
   *  session, the same way `SelfCancelAppointmentUseCase.clientId` is
   *  resolved by its endpoint rather than trusted from the request body.
   *  Never taken from `dayBoard` itself. */
  readonly barberId: string;
  readonly onSlotAction: (slotId: string, action: SlotAction) => void;
}

/**
 * Barber-facing entry point for `DayBoard` (barber-profile spec, "Agenda
 * propia filtrada"). Compare `AdminDayBoardContainer` (Phase 8): that one
 * trusts the fetched `dayBoard` completely because showing every column IS
 * correct for owner/secretary. Here it is not — a barber must never see a
 * colleague's slot, so this container filters to `barberId` itself, on top
 * of (never instead of) the server-side narrowing `DayBoardRepository`
 * already applies (task 8.7). Defense in depth: a future server-side
 * regression would still not leak a colleague's client name/age to this
 * screen.
 */
export function BarberDayBoardContainer({ dayBoard, barberId, onSlotAction }: BarberDayBoardContainerProps) {
  const columns = dayBoard.columns.filter((column) => column.barberId === barberId);
  const slots = dayBoard.slots.filter((slot) => slot.barberId === barberId);

  return <DayBoard columns={columns} slots={slots} onSlotAction={onSlotAction} />;
}
