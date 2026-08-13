import type { DayBoardResponse, SlotAction } from '@jc-barberia/contracts';

import { DayBoard } from './DayBoard';

export interface AdminDayBoardContainerProps {
  readonly dayBoard: DayBoardResponse;
  readonly onSlotAction: (slotId: string, action: SlotAction) => void;
}

/**
 * Admin-facing entry point for `DayBoard` (design.md: "AdminDayBoardContainer
 * (todas las columnas)"). Which columns/slots an owner or secretary may see
 * is already decided server-side — `GetDayBoardUseCase` plus
 * `DayBoardRepository`'s narrowing (tasks 8.3/8.4/8.7/8.8) — so this
 * container performs no filtering of its own; it exists as the
 * semantically-named seam a future admin page renders `dayBoard` through.
 * Compare `BarberDayBoardContainer` (Phase 11), the equivalent seam for the
 * single-barber case.
 */
export function AdminDayBoardContainer({ dayBoard, onSlotAction }: AdminDayBoardContainerProps) {
  return <DayBoard columns={dayBoard.columns} slots={dayBoard.slots} onSlotAction={onSlotAction} />;
}
