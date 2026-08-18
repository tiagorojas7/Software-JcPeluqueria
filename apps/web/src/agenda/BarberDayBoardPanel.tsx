import { useEffect, useState } from 'react';
import type { DayBoardResponse, SlotAction } from '@jc-barberia/contracts';

import { BarberDayBoardContainer } from './BarberDayBoardContainer';
import { apiGet, apiPost, describeError } from '../shared/api-client';

export interface BarberDayBoardPanelProps {
  readonly dayBoard: DayBoardResponse;
  readonly barberId: string;
}

const ACTION_PATH: Partial<Record<SlotAction, string>> = {
  'mark-completed': 'mark-completed',
  'confirm-absence': 'confirm-absence',
};

/**
 * B.6, barber side. `BarberDayBoardContainer` stays the exact `barberId`
 * filtering seam Phase 11 left (its own spec unmodified) — this panel wraps
 * it and turns `mark-completed`/`confirm-absence` into the real
 * `BarberMarkCompletedUseCase`/`BarberConfirmAbsenceUseCase` HTTP calls B.2
 * opened. `edit`/`cancel` never reach here at all — a barber's role has
 * neither `appointment:update` nor `appointment:cancel`
 * (`GetDayBoardUseCase.allowedActionsFor`), so `DayBoard` never renders
 * those buttons for this actor in the first place. Same reload-after-write
 * rule as `AdminDayBoardPanel`: `allowedActions` is server-computed, so this
 * panel never guesses it after a local mutation.
 */
export function BarberDayBoardPanel({ dayBoard: dayBoardProp, barberId }: BarberDayBoardPanelProps) {
  const [dayBoard, setDayBoard] = useState(dayBoardProp);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDayBoard(dayBoardProp);
  }, [dayBoardProp]);

  async function handleSlotAction(slotId: string, action: SlotAction) {
    setError(null);
    const segment = ACTION_PATH[action];
    if (!segment) {
      return;
    }
    try {
      await apiPost(`/appointments/${slotId}/${segment}`);
      const fresh = await apiGet<DayBoardResponse>(`/agenda/day-board?date=${encodeURIComponent(dayBoard.date)}`);
      setDayBoard(fresh);
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <BarberDayBoardContainer dayBoard={dayBoard} barberId={barberId} onSlotAction={handleSlotAction} />
    </div>
  );
}
