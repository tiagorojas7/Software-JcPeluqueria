import type { DayBoardColumn, DayBoardSlot, SlotAction } from '@jc-barberia/contracts';

import { utcIsoToShopLocalTime } from '../shared/shop-time';

export interface DayBoardProps {
  readonly columns: readonly DayBoardColumn[];
  readonly slots: readonly DayBoardSlot[];
  readonly onSlotAction: (slotId: string, action: SlotAction) => void;
}

const ACTION_LABELS: Record<SlotAction, string> = {
  edit: 'Editar',
  cancel: 'Cancelar',
  'mark-completed': 'Marcar realizado',
  'confirm-absence': 'Confirmar ausencia',
};

/**
 * Pure presentational organism (design.md, "Frontend"): draws exactly the
 * `columns`/`slots`/`allowedActions` it receives and never itself decides
 * what a viewer may do with a slot — that decision was already made on the
 * server (`GetDayBoardUseCase`). Reused unmodified by
 * `AdminDayBoardContainer` (Phase 8) and `BarberDayBoardContainer` (Phase
 * 11); which columns/slots either container passes in is entirely their
 * job, never this component's.
 */
export function DayBoard({ columns, slots, onSlotAction }: DayBoardProps) {
  return (
    <div>
      {columns.map((column) => (
        <section key={column.barberId} aria-label={column.barberName}>
          <h3>{column.barberName}</h3>
          <ul>
            {slots
              .filter((slot) => slot.barberId === column.barberId)
              .map((slot) => (
                <li key={slot.id}>
                  <span>
                    {utcIsoToShopLocalTime(slot.startsAt)}-{utcIsoToShopLocalTime(slot.endsAt)}
                  </span>
                  <span>{slot.serviceName}</span>
                  <span>{slot.status}</span>
                  {slot.clientName ? (
                    <span>
                      {slot.clientName}
                      {slot.clientAge !== undefined ? ` (${slot.clientAge})` : ''}
                    </span>
                  ) : null}
                  {slot.clientPhone ? <span>{slot.clientPhone}</span> : null}
                  {slot.allowedActions.map((action) => (
                    <button key={action} type="button" onClick={() => onSlotAction(slot.id, action)}>
                      {ACTION_LABELS[action]}
                    </button>
                  ))}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
