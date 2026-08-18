import type { AccountAppointmentResponse } from '@jc-barberia/contracts';

import { utcIsoToShopLocalTime } from '../shared/shop-time';

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
 * "Mi cuenta" (cablear-el-mvp Slice C, C.3/C.5): the client's own
 * appointments. Purely presentational — never calls the API itself, same
 * container/presentational split `DayBoard` already established: it only
 * draws what it receives and forwards a clicked id to its caller, who owns
 * the actual `POST /account/appointments/:id/cancel` call.
 */
export function AccountAppointmentsList({ appointments, onCancel }: AccountAppointmentsListProps) {
  if (appointments.length === 0) {
    return <p>Todavía no tenés turnos.</p>;
  }

  return (
    <ul>
      {appointments.map((appointment) => (
        <li key={appointment.id}>
          <span>{appointment.status}</span>{' '}
          <span>{utcIsoToShopLocalTime(appointment.startsAt)}</span>
          {appointment.status === CANCELLABLE_STATUS && (
            <button type="button" onClick={() => onCancel(appointment.id)}>
              Cancelar
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
