import { useEffect, useState, type FormEvent } from 'react';
import type { ClientLoginResponseBody, RequestClientAccessResponseBody } from '@jc-barberia/contracts';

import { AccessCodeForm, type AccessCodeFormStatus } from '../booking/AccessCodeForm';
import { apiPost, describeError } from '../shared/api-client';
import { useRouter } from '../shared/router';

/** Where the requested email is remembered between the "pedir código" step
 *  and coming back from the mail app — `localStorage`, not `sessionStorage`,
 *  because a mail app can open the link in a brand-new tab, which would not
 *  share a `sessionStorage` entry with the tab that requested the code. */
const ACCESS_EMAIL_STORAGE_KEY = 'jc-barberia:access-email';

/**
 * Every read/write is wrapped: a private window, cleared site data, or
 * storage disabled outright all either throw or silently no-op depending on
 * the browser — never fatal here, the client just gets asked for their
 * email again, the documented fallback (never the request id).
 */
function loadPersistedEmail(): string | null {
  try {
    return window.localStorage.getItem(ACCESS_EMAIL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function savePersistedEmail(email: string): void {
  try {
    window.localStorage.setItem(ACCESS_EMAIL_STORAGE_KEY, email);
  } catch {
    // Nothing to degrade further to — the next visit just asks again.
  }
}

function clearPersistedEmail(): void {
  try {
    window.localStorage.removeItem(ACCESS_EMAIL_STORAGE_KEY);
  } catch {
    // Same as above.
  }
}

interface MagicLinkParams {
  readonly challengeId: string;
  readonly token: string;
}

/**
 * The client-access-code email's magic link
 * (`client-access-code.template.ts`) lands here with both as query params —
 * never something a human types, so this is the ONE place `challengeId`
 * still exists on this screen.
 */
function readMagicLinkParams(): MagicLinkParams | null {
  const params = new URLSearchParams(window.location.search);
  const challengeId = params.get('challengeId');
  const token = params.get('token');
  if (!challengeId || !token) {
    return null;
  }
  return { challengeId, token };
}

/**
 * fix/acceso-cliente-sin-id: the shop owner was explicit — "la idea es que
 * el cliente solo ponga el codigo." Wires `POST /auth/request-client-access`
 * (EMAIL in, always `{outcome:'requested'}` out BY DESIGN — see
 * `RequestClientAccessUseCase`'s own doc comment for why) and
 * `POST /auth/client-login` with `{ email, secret }`
 * (`ClientLoginByEmailRequestSchema`) — never a `challengeId` a human has to
 * read out of an email and retype. The magic link is the one exception: it
 * carries `challengeId` + `token` in its OWN query string
 * (`readMagicLinkParams`), so following it authenticates with zero fields
 * typed at all.
 *
 * The requested email is persisted (`loadPersistedEmail`/`savePersistedEmail`)
 * so leaving for the mail app and coming back still shows only the code
 * field — re-typing the email is the fallback for when that context is
 * genuinely missing (a different browser, storage cleared), never the
 * default.
 *
 * `handleSubmitCode` never surfaces `must-request-new-code`: Decision 2
 * (fix/acceso-cliente-sin-id) — `ClientLoginByEmailUseCase` collapses every
 * dead-challenge case into the same `rejected` a wrong guess gets, so this
 * screen cannot become an oracle for which emails are registered customers
 * by watching who gets told their code specifically "expired". The
 * compensation lives in `AccessCodeForm`, which now always offers "pedir un
 * codigo nuevo" regardless of outcome.
 */
export function AccessCodePage() {
  const { navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [screen, setScreen] = useState<'email' | 'code'>('email');
  const [status, setStatus] = useState<AccessCodeFormStatus>({ outcome: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkingMagicLink, setCheckingMagicLink] = useState(true);

  useEffect(() => {
    const magicLink = readMagicLinkParams();
    if (!magicLink) {
      const persistedEmail = loadPersistedEmail();
      if (persistedEmail) {
        setEmail(persistedEmail);
        setScreen('code');
      }
      setCheckingMagicLink(false);
      return;
    }

    (async () => {
      try {
        const result = await apiPost<ClientLoginResponseBody>('/auth/client-login', {
          challengeId: magicLink.challengeId,
          secret: magicLink.token,
        });
        // The query string only ever mattered for this one call — dropping
        // it keeps a refresh from resubmitting an already-spent link.
        window.history.replaceState({}, '', '/acceder');
        if (result.outcome === 'authenticated') {
          clearPersistedEmail();
          navigate('/mi-cuenta');
          return;
        }
        const persistedEmail = loadPersistedEmail();
        if (persistedEmail) {
          setEmail(persistedEmail);
          setScreen('code');
        }
        setNotice('El enlace ya no es válido. Pedí un código nuevo si hace falta.');
      } catch (err) {
        window.history.replaceState({}, '', '/acceder');
        setError(describeError(err));
      } finally {
        setCheckingMagicLink(false);
      }
    })();
    // Runs exactly once, on mount, off the URL the page loaded with —
    // `navigate` is stable (`useCallback` in `RouterProvider`) and every
    // other value used inside is read fresh from storage/the URL itself.
  }, [navigate]);

  async function handleRequestCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost<RequestClientAccessResponseBody>('/auth/request-client-access', { email });
      savePersistedEmail(email);
      setScreen('code');
      setStatus({ outcome: 'idle' });
      setNotice('Si el email está registrado, te enviamos un código de acceso. Revisá tu correo y escribilo abajo.');
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleSubmitCode(code: string) {
    setError(null);
    try {
      const result = await apiPost<ClientLoginResponseBody>('/auth/client-login', { email, secret: code });
      if (result.outcome === 'authenticated') {
        clearPersistedEmail();
        navigate('/mi-cuenta');
        return;
      }
      // See this component's own doc comment: this path never sees
      // 'must-request-new-code' in practice, but the type still allows it —
      // treated identically to 'rejected' either way (Decision 2).
      setStatus({ outcome: 'rejected' });
      setNotice('Código incorrecto o vencido. Si hace falta, pedí uno nuevo.');
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleRequestNewCode() {
    setError(null);
    if (!email) {
      // Fallback only — the default path always already knows the email.
      setScreen('email');
      setStatus({ outcome: 'idle' });
      setNotice(null);
      return;
    }
    try {
      await apiPost<RequestClientAccessResponseBody>('/auth/request-client-access', { email });
      savePersistedEmail(email);
      setStatus({ outcome: 'idle' });
      setNotice('Te enviamos un código nuevo. Revisá tu correo.');
    } catch (err) {
      setError(describeError(err));
    }
  }

  if (checkingMagicLink) {
    return (
      <section className="container access-code-page">
        <div className="card access-code-page__card">
          <p role="status">Verificando el enlace...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="container access-code-page">
      <div className="card access-code-page__card">
        <span className="access-code-page__brand">JC Barbería</span>
        <h2>Ingresar con código</h2>
        <p>Si ya reservaste antes, pedí un código para ver y gestionar tus turnos.</p>

        {/* Entering without a password is the unusual part of this flow and
            it was nowhere on screen: someone arriving here looks for a
            password field that does not exist and concludes the page is
            broken or that they never had an account. */}
        <p className="access-code-page__note">
          Sin contraseña: te mandamos un código por email cada vez que quieras entrar.
        </p>

        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {screen === 'email' ? (
          <form onSubmit={handleRequestCode}>
            <label htmlFor="access-email">Email</label>
            <input id="access-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit">Pedir código</button>
          </form>
        ) : (
          <>
            {/* The address the code went to is the one thing people mistype,
                and without seeing it they cannot work out why no mail
                arrived. */}
            {email && (
              <p className="access-code-page__sent-to">
                Código enviado a <strong>{email}</strong>
              </p>
            )}
            <AccessCodeForm status={status} onSubmit={handleSubmitCode} onRequestNewCode={handleRequestNewCode} />
          </>
        )}
      </div>
    </section>
  );
}
