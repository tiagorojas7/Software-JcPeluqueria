import { useEffect, useState } from 'react';
import type { ListOwnAppointmentsResponse, SelfCancelAppointmentResponseBody } from '@jc-barberia/contracts';

import { AccountAppointmentsList } from './AccountAppointmentsList';
import { ApiError, apiGet, apiPost, describeError } from '../shared/api-client';
import { utcIsoToShopLocalTime } from '../shared/shop-time';

/**
 * "Mi cuenta" (cablear-el-mvp Slice C, C.3/C.4/C.5). Lives in this module's
 * own folder rather than `apps/web/src/pages/` — Slice D owns that
 * directory's layout/navigation; this page is wired into `App.tsx` through
 * a single route entry instead. Unlike every `pages/*Page.tsx` screen, there
 * is no staff `Actor` to gate on here: a client's identity IS the session
 * cookie (`@RequiresClientSession()`), resolved entirely server-side, so
 * this fetches on mount rather than waiting for a form submit. A 403 here
 * means "not logged in yet", never a bug — shown as an ordinary message,
 * not `describeError`'s generic fallback.
 */
export function MyAccountPage() {
  const [appointments, setAppointments] = useState<ListOwnAppointmentsResponse['appointments'] | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiGet<ListOwnAppointmentsResponse>('/account/appointments')
      .then((response) => {
        if (active) {
          setAppointments(response.appointments);
        }
      })
      .catch((err: unknown) => {
        if (!active) {
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setLoggedOut(true);
        } else {
          setError(describeError(err));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleCancel(appointmentId: string) {
    setError(null);
    setNotice(null);
    try {
      const result = await apiPost<SelfCancelAppointmentResponseBody>(
        `/account/appointments/${appointmentId}/cancel`,
      );
      if (result.outcome === 'cancelled') {
        setAppointments((prev) => prev?.map((a) => (a.id === appointmentId ? result.appointment : a)) ?? prev);
        setNotice('Turno cancelado. Si tenía una seña cobrada, se reembolsa automáticamente.');
      } else if (result.outcome === 'too-late') {
        setNotice(`Ya no se puede cancelar: la ventana cerró a las ${utcIsoToShopLocalTime(result.cutoff)}.`);
      } else {
        // 'not-yours' / 'not-cancellable' should not happen from this
        // screen's own list, but the exhaustive switch stays honest about
        // every outcome the backend can return.
        setError('No se pudo cancelar el turno.');
      }
    } catch (err) {
      setError(describeError(err));
    }
  }

  if (loggedOut) {
    return (
      <section>
        <h2>Mi cuenta</h2>
        <p>Iniciá sesión con tu código de acceso para ver esta pantalla.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Mi cuenta</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {appointments ? (
        <AccountAppointmentsList appointments={appointments} onCancel={handleCancel} />
      ) : (
        <p>Cargando...</p>
      )}
    </section>
  );
}
