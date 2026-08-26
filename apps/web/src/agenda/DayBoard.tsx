import type { DayBoardColumn, DayBoardSlot, SlotAction } from '@jc-barberia/contracts';

import { appointmentStatusLabel } from '../shared/appointment-status';
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
    <div className="day-board__columns">
      {columns.map((column) => {
        const columnSlots = slots.filter((slot) => slot.barberId === column.barberId);

        return (
          <section key={column.barberId} aria-label={column.barberName} className="day-board__column">
            <h3>{column.barberName}</h3>
            <ul>
              {columnSlots.map((slot) => (
                <li key={slot.id} className={`day-board__slot day-board__slot--${slot.status}`}>
                  <span className="day-board__time">
                    {utcIsoToShopLocalTime(slot.startsAt)}-{utcIsoToShopLocalTime(slot.endsAt)}
                  </span>
                  <span className="day-board__service">{slot.serviceName}</span>
                  <span
                    className={`day-board__status day-board__status--${slot.status}`}
                    aria-label={`Estado: ${appointmentStatusLabel(slot.status)}`}
                  >
                    {appointmentStatusLabel(slot.status)}
                  </span>
                  {slot.clientName ? (
                    <span className="day-board__client">
                      {slot.clientName}
                      {slot.clientAge !== undefined ? ` (${slot.clientAge})` : ''}
                    </span>
                  ) : null}
                  {slot.clientPhone ? <span className="day-board__phone">{slot.clientPhone}</span> : null}
                  {slot.allowedActions.length > 0 ? (
                    <span className="day-board__actions">
                      {slot.allowedActions.map((action) => (
                        <button
                          key={action}
                          type="button"
                          className={action === 'mark-completed' ? 'btn-primary' : undefined}
                          onClick={() => onSlotAction(slot.id, action)}
                        >
                          {ACTION_LABELS[action]}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
