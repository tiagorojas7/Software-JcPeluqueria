import { useState, type FormEvent } from 'react';
import type { ActivateStaffResponseBody } from '@jc-barberia/contracts';

import { apiPost, describeError } from '../shared/api-client';
import { Link } from '../shared/router';

interface ActivationLinkParams {
  readonly challengeId: string;
  readonly token: string;
}

/**
 * The activation email's link (`staff-activation.template.ts`) lands here
 * with both as query params. Neither is ever typed by a person — there is no
 * field for them on this screen, on purpose: the link IS the proof of who
 * this is.
 */
function readActivationParams(): ActivationLinkParams | null {
  const params = new URLSearchParams(window.location.search);
  const challengeId = params.get('challengeId');
  const token = params.get('token');
  if (!challengeId || !token) {
    return null;
  }
  return { challengeId, token };
}

type Status = 'idle' | 'submitting' | 'activated';

/**
 * Where a new barber picks their own password, once, from the invite the
 * owner sent (README section 3.9: the profile "es la puerta por la que entra
 * al sistema"). Public by construction — whoever follows this link has no
 * account to log into yet; that is the whole point.
 *
 * This is the ONLY screen in the application where a staff password is
 * typed for the first time, and it belongs to the barber, not to the owner:
 * the owner's panel has no field that could set one (see
 * `BarberAccountsSection`). Re-sending the invite from there brings the
 * barber back HERE, which is why "reenviar invitación" and "resetear
 * contraseña" are the same button doing the same thing.
 *
 * A weak password keeps the link alive — the API validates before consuming
 * the challenge — so the retry hint is honest: the same email still works.
 */
export function StaffActivationPage() {
  const params = readActivationParams();
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!params) {
    return (
      <section className="container" style={{ padding: '64px 0' }}>
        <h2>Enlace incompleto</h2>
        <p>
          Este enlace de activación está incompleto. Abrilo directamente desde el correo que te llegó, o pedile al dueño
          que te lo reenvíe desde el panel.
        </p>
      </section>
    );
  }

  if (status === 'activated') {
    return (
      <section className="container" style={{ padding: '64px 0' }}>
        <h2>Cuenta activada</h2>
        <p>Ya podés entrar al panel con tu email y la contraseña que elegiste.</p>
        <Link to="/panel">Ir al panel</Link>
      </section>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== repeated) {
      // Checked here and nowhere else: the API has no second field to
      // compare against, and never should — a typo is a browser-side
      // problem, not a reason to burn the activation link.
      setError('Las dos contraseñas no coinciden.');
      return;
    }
    setStatus('submitting');
    try {
      const result = await apiPost<ActivateStaffResponseBody>('/auth/activate-staff', {
        challengeId: params!.challengeId,
        secret: params!.token,
        newPassword: password,
      });
      if (result.outcome === 'activated') {
        setStatus('activated');
        return;
      }
      setStatus('idle');
      setError(
        result.outcome === 'weak-password'
          ? `${result.message} Probá con una más larga: el enlace sigue sirviendo.`
          : 'Este enlace ya se usó o venció. Pedile al dueño que te lo reenvíe desde el panel.',
      );
    } catch (err) {
      setStatus('idle');
      setError(describeError(err));
    }
  }

  return (
    <section className="container" style={{ padding: '64px 0' }}>
      <h2>Activá tu cuenta</h2>
      <p>Elegí la contraseña con la que vas a entrar al panel. Nadie más la conoce, ni siquiera el dueño.</p>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={handleSubmit}>
        <span>
          <label htmlFor="staff-activation-password">Contraseña</label>
          <input
            id="staff-activation-password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <small>Al menos 12 caracteres.</small>
        </span>
        <span>
          <label htmlFor="staff-activation-repeat">Repetí la contraseña</label>
          <input
            id="staff-activation-repeat"
            type="password"
            required
            autoComplete="new-password"
            value={repeated}
            onChange={(e) => setRepeated(e.target.value)}
          />
        </span>
        <button type="submit" disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Activando...' : 'Activar cuenta'}
        </button>
      </form>
    </section>
  );
}
