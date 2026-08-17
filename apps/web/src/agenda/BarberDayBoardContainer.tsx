import type { DayBoardResponse, SlotAction } from '@jc-barberia/contracts';
import type { ActorContext } from '@jc-barberia/domain';

import { DayBoard } from './DayBoard';

export interface BarberDayBoardContainerProps {
  readonly dayBoard: DayBoardResponse;
  readonly onSlotAction: (slotId: string, action: SlotAction) => void;
  readonly actor: ActorContext;
}

/**
 * Barber-facing container for `DayBoard` (Phase 11, tasks 11.1/11.2).
 * Filters the day board to show only the authenticated barber's column.
 * Reuses the `DayBoard` presentational organism and the auth guard from Phase 3b
 * (role `barbero`).
 */
export function BarberDayBoardContainer({
  dayBoard,
  onSlotAction,
  actor,
}: BarberDayBoardContainerProps) {
  const myColumn = dayBoard.columns.find(
    (column) => column.barberId === actor.barberId,
  );

  if (!myColumn) {
    return null;
  }

  return (
    <DayBoard
      columns={[myColumn]}
      slots={dayBoard.slots}
      onSlotAction={onSlotAction}
    />
  );
}