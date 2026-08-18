import { useState } from 'react';

import { AccessCodeForm, type AccessCodeFormStatus } from '../booking/AccessCodeForm';

/**
 * Mounts `AccessCodeForm` (returning-client login, client-booking spec) for
 * screen completeness/navigation — its real backing use case
 * (`RequestClientAccessUseCase`) needs a `NotificationOutboxRepository`
 * Postgres adapter that does not exist anywhere in this codebase yet (only a
 * domain-level fake — see `packages/domain/src/notifications/testing`), and
 * `apps/worker`'s own TODO comments already flag that same gap as Slice A's
 * job, not this slice's. This page says so honestly, in plain language,
 * instead of pretending the flow works.
 */
export function AccessCodePage() {
  const [status] = useState<AccessCodeFormStatus>({ outcome: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);

  function notAvailable() {
    setNotice('Todavía no podés ingresar con código. Comunicate con la barbería para gestionar tu turno.');
  }

  return (
    <section className="container access-code-page">
      <div className="card access-code-page__card">
        <h2>Ingresar con código</h2>
        <p>Si ya reservaste antes, ingresá el código que te enviamos para ver tus turnos.</p>
        {notice && <p role="alert">{notice}</p>}
        <AccessCodeForm status={status} onSubmit={notAvailable} onRequestNewCode={notAvailable} />
      </div>
    </section>
  );
}
