import { useState } from 'react';
import type { AccountAppointmentResponse } from '@jc-barberia/contracts';

import { appointmentStatusLabel } from '../shared/appointment-status';
import { nowMs } from '../shared/now';
import { utcIsoToShopLocalDate, utcIsoToShopLocalTime } from '../shared/shop-time';

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

/**
 * panel-usable: `SelfCancelAppointmentUseCase` blocks self-cancellation
 * entirely once inside the last hour before the turno — it never cancels
 * "late, no refund", it just refuses with `too-late`. That refusal used to
 * only ever surface AFTER the client clicked "Cancelar" and the request came
 * back. This estimates the SAME rule client-side (`nowMs()` vs
 * `startsAt - SELF_CANCEL_WINDOW_MINUTES`, pure epoch-millisecond
 * arithmetic — no `Date` construction, per the repo-wide Clock-only ESLint
 * rule) so the client is told BEFORE confirming, not after: still in time
 * (and a settled deposit refunds automatically, per
 * `resolveDepositForCancellation`), or already too late to cancel from here
 * at all. The server call in `onCancel` remains the one source of truth for
 * the ACTUAL outcome — this estimate only decides what the confirmation step
 * says and whether it offers a "Confirmar cancelación" button at all; it
 * never skips the real request.
 */
export function AccountAppointmentsList({ appointments, onCancel }: AccountAppointmentsListProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (appointments.length === 0) {
    return <p>Todavía no tenés turnos.</p>;
  }

  return (
    <ul>
      {appointments.map((appointment) => {
        const isCancellable = appointment.status === CANCELLABLE_STATUS;
        const isConfirming = confirmingId === appointment.id;
        const cutoffMs = Date.parse(appointment.startsAt) - SELF_CANCEL_WINDOW_MINUTES * 60_000;
        const stillWithinWindow = nowMs() < cutoffMs;

        return (
          <li
            key={appointment.id}
            className={`account-appointments__item account-appointments__item--${appointment.status}`}
          >
            <span className="account-appointments__when">
              <span className="account-appointments__date">
                {utcIsoToShopLocalDate(appointment.startsAt)}
              </span>
              <span className="account-appointments__time">
                {utcIsoToShopLocalTime(appointment.startsAt)}
              </span>
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
                    Ya pasó el límite de {SELF_CANCEL_WINDOW_MINUTES} minutos antes del turno: no podés cancelarlo
                    vos mismo. Contactá al local si lo necesitás.
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
      })}
    </ul>
  );
}
