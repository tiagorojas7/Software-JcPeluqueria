import { useState } from 'react';

import { AccessCodeForm, type AccessCodeFormStatus } from '../booking/AccessCodeForm';

/**
 * Mounts `AccessCodeForm` (returning-client login, client-booking spec) for
 * screen completeness/navigation — its real backing use case
 * (`RequestClientAccessUseCase`) needs a `NotificationOutboxRepository`
 * Postgres adapter that does not exist anywhere in this codebase yet (only a
 * domain-level fake — see `packages/domain/src/notifications/testing`), and
 * `apps/worker`'s own TODO comments already flag that same gap as deferred
 * to "Phase 7". Wiring a real HTTP endpoint for this would mean building new
 * infrastructure this arranque slice was not asked for (see apply-progress
 * for the explicit note) — this page says so honestly instead of pretending
 * to work.
 */
export function AccessCodePage() {
  const [status] = useState<AccessCodeFormStatus>({ outcome: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);

  function notAvailable() {
    setNotice(
      'El login de clientes por código todavía no tiene un backend real conectado en esta demo ' +
        '(falta el adaptador de outbox de notificaciones — ver docs/DEMO.md).',
    );
  }

  return (
    <section>
      <h2>Ingresar con código (cliente)</h2>
      {notice && <p role="alert">{notice}</p>}
      <AccessCodeForm status={status} onSubmit={notAvailable} onRequestNewCode={notAvailable} />
    </section>
  );
}
