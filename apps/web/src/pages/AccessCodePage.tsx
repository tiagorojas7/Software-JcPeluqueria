import { useState, type FormEvent } from 'react';
import type { ClientLoginResponseBody, RequestClientAccessResponseBody } from '@jc-barberia/contracts';

import { AccessCodeForm, type AccessCodeFormStatus } from '../booking/AccessCodeForm';
import { apiPost, describeError } from '../shared/api-client';
import { useRouter } from '../shared/router';

/**
 * cablear-el-mvp Slice C (C.7): wires the two endpoints C.1/C.2 already
 * expose — `POST /auth/request-client-access` (phone in, always
 * `{outcome:'requested'}` out BY DESIGN, never a `challengeId`: returning one
 * only when a challenge was actually issued would itself be the disclosure
 * `RequestClientAccessUseCase`'s own doc comment refuses to make, since an
 * unregistered phone issues no challenge at all) and `POST /auth/client-login`
 * (`challengeId` + `secret` in, per `ClientLoginRequestSchema`).
 *
 * Because the first call can never hand the browser a `challengeId`, this
 * page asks for it directly as its own field rather than pretending the
 * browser already knows it. In today's MVP nothing delivers that id to a real
 * phone either (the access-code email's magic link only carries `token`, and
 * there is no SMS channel yet), so — exactly like the plaintext code — a
 * client reads it from wherever the notification landed
 * (`notification_outbox` / the worker's console). That gap belongs to the
 * notification templates (`packages/infrastructure`), outside this slice.
 *
 * The one-shape response from step one is rendered as the SAME notice
 * regardless of what happened server-side, keeping the non-disclosure intact
 * on this screen: nothing here ever branches on whether the phone was on
 * file.
 */
export function AccessCodePage() {
  const { navigate } = useRouter();
  const [phone, setPhone] = useState('');
  const [requested, setRequested] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [status, setStatus] = useState<AccessCodeFormStatus>({ outcome: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost<RequestClientAccessResponseBody>('/auth/request-client-access', { phone });
      setRequested(true);
      setNotice(
        'Si el teléfono está registrado, te enviamos un código de acceso y el ID de la solicitud. Completá los dos campos de abajo para ingresar.',
      );
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleSubmitCode(code: string) {
    setError(null);
    try {
      const result = await apiPost<ClientLoginResponseBody>('/auth/client-login', {
        challengeId,
        secret: code,
      });
      if (result.outcome === 'authenticated') {
        navigate('/mi-cuenta');
        return;
      }
      if (result.outcome === 'rejected') {
        setStatus({ outcome: 'rejected' });
        setNotice('Código incorrecto. Podés volver a intentarlo.');
        return;
      }
      setStatus({ outcome: 'must-request-new-code', reason: result.reason });
      setNotice(null);
    } catch (err) {
      setError(describeError(err));
    }
  }

  function handleRequestNewCode() {
    setRequested(false);
    setChallengeId('');
    setStatus({ outcome: 'idle' });
    setNotice(null);
    setError(null);
  }

  return (
    <section className="container access-code-page">
      <div className="card access-code-page__card">
        <h2>Ingresar con código</h2>
        <p>Si ya reservaste antes, pedí un código para ver y gestionar tus turnos.</p>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!requested ? (
          <form onSubmit={handleRequestCode}>
            <label htmlFor="access-phone">Teléfono</label>
            <input id="access-phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button type="submit">Pedir código</button>
          </form>
        ) : (
          <>
            <div>
              <label htmlFor="access-challenge-id">ID de la solicitud</label>
              <input
                id="access-challenge-id"
                value={challengeId}
                onChange={(e) => setChallengeId(e.target.value)}
              />
            </div>
            <AccessCodeForm status={status} onSubmit={handleSubmitCode} onRequestNewCode={handleRequestNewCode} />
          </>
        )}
      </div>
    </section>
  );
}
