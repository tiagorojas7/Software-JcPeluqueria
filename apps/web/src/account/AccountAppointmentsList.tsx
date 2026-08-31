import { useMemo, useState } from 'react';
import type { AccountAppointmentResponse } from '@jc-barberia/contracts';

import { appointmentStatusLabel } from '../shared/appointment-status';
import { nowMs } from '../shared/now';
import { formatCalendarDateLong, utcIsoToShopLocalTime } from '../shared/shop-time';

export interface AccountAppointmentsListProps {
  readonly appointments: readonly AccountAppointmentResponse[];
  readonly onCancel: (appointmentId: string) => void;
}

/** Only a `reservado` turno can ever succeed at self-cancel
 *  (`SelfCancelAppointmentUseCase`'s exhaustive outcome switch) — showing
 *  the button on an already-`cancelado`/`realizado` row would just produce a
 *  guaranteed `not-cancellable` round trip for no reason. */
const CANCELLABLE_STATUS = 'reservado';

/**
 * Mirrors `SelfCancelAppointmentUseCase.SELF_CANCEL_WINDOW_MINUTES`
 * (`packages/application/src/appointments/self-cancel-appointment.ts`) — this
 * SPA never imports the application layer, so the number is restated here,
 * the same duplication `shop-time.ts`'s `SHOP_UTC_OFFSET_MINUTES` already
 * accepts for the identical reason.
 */
const SELF_CANCEL_WINDOW_MINUTES = 60;

/** The `YYYY-MM-DD` an ISO instant falls on, shop-local. Safe to slice: the
 *  shop opens 09:00 and closes 20:00 local (12:00-23:00 UTC at the fixed
 *  -03:00 offset), so no appointment ever lands near UTC midnight — the same
 *  reasoning `utcIsoToShopLocalDate` already documents. */
function calendarDateOf(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * "Mi cuenta"'s list of turnos.
 *
 * The owner opened his own account and found 44 turnos in a single
 * undifferentiated pile — easy to get lost in, in his words. A person comes
 * to this screen for ONE thing: when is my next appointment. Only then,
 * maybe, for their history. So the screen answers that first, in its own
 * block, and everything else is subordinate to it:
 *
 *  - the NEXT turno is lifted out and shown on its own,
 *  - the remaining upcoming ones follow, soonest first — the order you act
 *    on them,
 *  - history comes last, most recent first — the order you remember it in —
 *    behind a status filter so it never becomes a wall again.
 *
 * "Upcoming" is decided by the CLOCK, not by status: a `reservado` whose
 * hour already passed belongs to history even though no daily sweep has
 * updated it yet.
 */
export function AccountAppointmentsList({ appointments, onCancel }: AccountAppointmentsListProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** `'todos'` o uno de los estados presentes en el historial. El contrato
   *  pasa `status` como `string` crudo, así que el filtro habla ese mismo
   *  idioma en vez de inventar un tipo que la respuesta no garantiza. */
  const [historyFilter, setHistoryFilter] = useState<string>('todos');

  const { next, upcoming, history } = useMemo(() => {
    const now = nowMs();
    const future = appointments
      .filter((appointment) => Date.parse(appointment.startsAt) >= now)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const past = appointments
      .filter((appointment) => Date.parse(appointment.startsAt) < now)
      .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
    return { next: future[0] ?? null, upcoming: future.slice(1), history: past };
  }, [appointments]);

  const historyStatuses = useMemo(
    () => [...new Set(history.map((appointment) => appointment.status))],
    [history],
  );
  const visibleHistory =
    historyFilter === 'todos' ? history : history.filter((appointment) => appointment.status === historyFilter);

  if (appointments.length === 0) {
    return <p className="empty-state">Todavía no tenés turnos.</p>;
  }

  function renderRow(appointment: AccountAppointmentResponse, highlighted = false) {
    const isCancellable = appointment.status === CANCELLABLE_STATUS;
    const isConfirming = confirmingId === appointment.id;
    const cutoffMs = Date.parse(appointment.startsAt) - SELF_CANCEL_WINDOW_MINUTES * 60_000;
    const stillWithinWindow = nowMs() < cutoffMs;
    const itemClass = [
      'account-appointments__item',
      `account-appointments__item--${appointment.status}`,
      highlighted ? 'account-appointments__item--next' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <li key={appointment.id} className={itemClass}>
        <span className="account-appointments__when">
          <span className="account-appointments__date" data-testid="appointment-date">
            {formatCalendarDateLong(calendarDateOf(appointment.startsAt))}
          </span>
          <span className="account-appointments__time">{utcIsoToShopLocalTime(appointment.startsAt)}</span>
        </span>
        <span className="account-appointments__what">
          <strong>{appointment.serviceName}</strong>
          <span className="account-appointments__with">con {appointment.barberName}</span>
        </span>
        <span
          className={`account-appointments__status account-appointments__status--${appointment.status}`}
          aria-label={`Estado: ${appointmentStatusLabel(appointment.status)}`}
        >
          {appointmentStatusLabel(appointment.status)}
        </span>
        {isCancellable && !isConfirming && (
          <button type="button" onClick={() => setConfirmingId(appointment.id)}>
            Cancelar
          </button>
        )}
        {isCancellable && isConfirming && (
          <div className="account-appointments__confirm">
            {stillWithinWindow ? (
              <p>Todavía estás a tiempo: si pagaste una seña, se te reembolsa automáticamente al cancelar.</p>
            ) : (
              <p role="alert">
                Ya pasó el límite de {SELF_CANCEL_WINDOW_MINUTES} minutos antes del turno: no podés cancelarlo vos
                mismo. Contactá al local si lo necesitás.
              </p>
            )}
            {stillWithinWindow && (
              <button
                type="button"
                onClick={() => {
                  setConfirmingId(null);
                  onCancel(appointment.id);
                }}
              >
                Confirmar cancelación
              </button>
            )}
            <button type="button" onClick={() => setConfirmingId(null)}>
              Volver
            </button>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="account-appointments">
      {next ? (
        <section className="account-appointments__next" aria-label="Tu próximo turno">
          <h3>Tu próximo turno</h3>
          <ul>{renderRow(next, true)}</ul>
        </section>
      ) : (
        <p className="empty-state">No tenés ningún turno agendado. ¿Reservamos uno?</p>
      )}

      {upcoming.length > 0 && (
        <section aria-label="Próximos turnos">
          <h3>Próximos turnos</h3>
          <ul>{upcoming.map((appointment) => renderRow(appointment))}</ul>
        </section>
      )}

      {history.length > 0 && (
        <section aria-label="Historial">
          <div className="account-appointments__history-head">
            <h3>Historial</h3>
            <label htmlFor="account-history-filter">Mostrar</label>
            <select
              id="account-history-filter"
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
            >
              <option value="todos">Todos</option>
              {historyStatuses.map((status) => (
                <option key={status} value={status}>
                  {appointmentStatusLabel(status)}
                </option>
              ))}
            </select>
          </div>
          {visibleHistory.length > 0 ? (
            <ul>{visibleHistory.map((appointment) => renderRow(appointment))}</ul>
          ) : (
            <p className="empty-state">No hay turnos con ese estado.</p>
          )}
        </section>
      )}
    </div>
  );
}
