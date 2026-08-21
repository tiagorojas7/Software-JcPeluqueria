import { Link } from '../shared/router';

/**
 * cuenta-cliente-persistente: the invitation the shop owner asked for —
 * once a booking finishes, the client should be told he can come back
 * later, without typing anything but the email he already gave, to see and
 * manage his turnos. Shared verbatim by `BookingPage` (right after the
 * account is created, while the reservation is about to go to MercadoPago —
 * the client may never return to this exact screen once redirected) and
 * `PaymentReturnPage` (the "came back from MercadoPago" landing), so the
 * copy never drifts between the two places a client can see it.
 */
export function AccessCodeNotice() {
  return (
    <p className="access-code-notice">
      Guardá esto: cuando quieras, podés{' '}
      <Link to="/acceder">pedir un código de acceso</Link> con el mismo email que usaste para reservar, y ver o
      cancelar tus turnos.
    </p>
  );
}
