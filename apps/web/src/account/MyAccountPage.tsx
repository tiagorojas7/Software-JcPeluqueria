import { useEffect, useState } from 'react';
import type {
  ListOwnAppointmentsResponse,
  SelfCancelAppointmentResponseBody,
  SelfCancelRefundOutcome,
} from '@jc-barberia/contracts';

import { AccountAppointmentsList } from './AccountAppointmentsList';
import { ApiError, apiGet, apiPost, describeError } from '../shared/api-client';
import { nowMs } from '../shared/now';
import './MyAccountPage.css';

/** Mirrors `SELF_CANCEL_WINDOW_MINUTES` (packages/application). Duplicated
 *  rather than imported because this SPA never depends on the domain
 *  packages; the number is only used to WARN, and the server decides. */
const FREE_CANCEL_WINDOW_MS = 60 * 60 * 1000;

/** Says what actually happened to the money, read off the server's answer
 *  instead of re-deriving it from the clock in the browser. */
const CANCEL_NOTICE: Record<SelfCancelRefundOutcome, string> = {
  refunded: 'Turno cancelado. La seña se devuelve automáticamente.',
  forfeited: 'Turno cancelado. Por cancelar con menos de una hora de anticipación, la seña no se devuelve.',
  none: 'Turno cancelado.',
};

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
  /** The turno awaiting the client's confirmation, if any. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
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

  async function confirmCancel(appointmentId: string) {
    setConfirmingId(null);
    setError(null);
    setNotice(null);
    try {
      const result = await apiPost<SelfCancelAppointmentResponseBody>(
        `/account/appointments/${appointmentId}/cancel`,
      );
      if (result.outcome === 'cancelled') {
        setAppointments((prev) => prev?.map((a) => (a.id === appointmentId ? result.appointment : a)) ?? prev);
        // `noUncheckedIndexedAccess` widens every lookup to `| undefined`,
        // even over a closed key union; the fallback is the neutral wording.
        setNotice(CANCEL_NOTICE[result.refund] ?? CANCEL_NOTICE.none);
      } else {
        // 'not-yours' / 'not-cancellable' should not happen from this
        // screen's own list, but staying honest about every outcome the
        // backend can return keeps a stale page from lying.
        setError('No se pudo cancelar el turno.');
      }
    } catch (err) {
      setError(describeError(err));
    }
  }

  if (loggedOut) {
    return (
      <section className="container my-account">
        <h2>Mi cuenta</h2>
        <p className="empty-state">Iniciá sesión con tu código de acceso para ver esta pantalla.</p>
      </section>
    );
  }

  const pending = appointments?.find((a) => a.id === confirmingId) ?? null;

  return (
    <section className="container my-account">
      <h2>Mi cuenta</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {/* La política se explica ANTES de confirmar, no después: perder la seña
          es una consecuencia que el cliente tiene derecho a conocer mientras
          todavía puede echarse atrás. */}
      {pending && (
        <div role="alertdialog" aria-label="Confirmar cancelación" className="my-account__confirm">
          <p>
            {losesDeposit(pending.startsAt)
              ? 'Falta menos de una hora para tu turno, así que por la política de devolución la seña no se devuelve. El horario queda liberado igual. ¿Querés cancelarlo?'
              : '¿Querés cancelar este turno? La seña se devuelve automáticamente.'}
          </p>
          <button type="button" onClick={() => void confirmCancel(pending.id)}>
            Sí, cancelar el turno
          </button>
          <button type="button" onClick={() => setConfirmingId(null)}>
            No, volver
          </button>
        </div>
      )}

      {appointments ? (
        <AccountAppointmentsList appointments={appointments} onCancel={setConfirmingId} />
      ) : (
        <p className="empty-state">Cargando...</p>
      )}
    </section>
  );
}

/** Whether cancelling now would forfeit the deposit. Only drives the WARNING
 *  — the server re-decides it against its own clock, so a stale page can
 *  never talk the backend into refunding something it should not. */
function losesDeposit(startsAt: string): boolean {
  return Date.parse(startsAt) - nowMs() < FREE_CANCEL_WINDOW_MS;
}
