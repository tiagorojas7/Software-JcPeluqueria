import type { DayBoardColumn, DayBoardSlot, SlotAction } from '@jc-barberia/contracts';

import {
  appointmentChannelLabel,
  appointmentStatusCountLabel,
  appointmentStatusLabel,
  STATUS_DISPLAY_ORDER,
} from '../shared/appointment-status';
import { utcIsoToShopLocalTime } from '../shared/shop-time';

const PENDING_STATUS = 'sin_registrado';

/**
 * How many of these slots are in each status, listed in the order the panel
 * shows them (`STATUS_DISPLAY_ORDER`) and skipping the statuses this barber
 * has none of — a row of zeroes is noise, not information.
 */
function countByStatus(slots: readonly DayBoardSlot[]): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const slot of slots) {
    counts.set(slot.status, (counts.get(slot.status) ?? 0) + 1);
  }

  return STATUS_DISPLAY_ORDER.filter((status) => counts.has(status)).map(
    (status) => [status, counts.get(status) as number] as const,
  );
}

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
  const pendingCount = slots.filter((slot) => slot.status === PENDING_STATUS).length;

  return (
    <div className="day-board__columns">
      {pendingCount > 0 ? (
        <p role="status" className="day-board__pending">
          {pendingCount === 1
            ? '1 turno sin registrar espera que alguien lo resuelva'
            : `${pendingCount} turnos sin registrar esperan que alguien los resuelva`}
          . Confirmá si se hicieron o si el cliente no vino.
        </p>
      ) : null}
      {columns.map((column) => {
        const columnSlots = slots.filter((slot) => slot.barberId === column.barberId);
        const summary = countByStatus(columnSlots);

        return (
          <section key={column.barberId} aria-label={column.barberName} className="day-board__column">
            <h3>{column.barberName}</h3>
            <p className="day-board__hours">
              {column.opensAt && column.closesAt
                ? `${column.opensAt} – ${column.closesAt}`
                : 'No trabaja este día'}
            </p>
            {summary.length > 0 ? (
              <p className="day-board__summary">
                {summary.map(([status, count]) => (
                  <span key={status} className={`day-board__status day-board__status--${status}`}>
                    {appointmentStatusCountLabel(status, count)}
                  </span>
                ))}
              </p>
            ) : null}
            <ul>
              {columnSlots.map((slot) => (
                <li key={slot.id} className={`day-board__slot day-board__slot--${slot.status}`}>
                  <span className="day-board__time">
                    {utcIsoToShopLocalTime(slot.startsAt)}-{utcIsoToShopLocalTime(slot.endsAt)}
                  </span>
                  <span className="day-board__service">
                    {slot.serviceName}
                    {appointmentChannelLabel(slot.channel) ? (
                      <span className={`day-board__channel day-board__channel--${slot.channel}`}>
                        {appointmentChannelLabel(slot.channel)}
                      </span>
                    ) : null}
                  </span>
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
