import { useState, type FormEvent } from 'react';
import type { StaffLoginResponseBody } from '@jc-barberia/contracts';

import { apiPost, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';
import './StaffLoginPage.css';

export interface StaffLoginPageProps {
  readonly onLoggedIn: (actor: Actor) => void;
  /** `true` when the staff member did not choose to leave: their session
   *  expired underneath them and the panel sent them back here. Saying so
   *  is the difference between "andá a saber qué pasó" and one sentence
   *  that explains it. */
  readonly sessionExpired?: boolean;
}

/**
 * The panel's own entry point (D.1): rendered standalone at `/panel/login`,
 * never inside `PanelLayout` — there is no `Actor` yet to give it. Alta y
 * reseteo de personal quedan fuera de alcance a propósito (tasks.md, "Fuera
 * de alcance, explícito"): el mensaje de recuperación dirige a hablar con el
 * dueño en vez de prometer un flujo que no existe.
 */
export function StaffLoginPage({ onLoggedIn, sessionExpired = false }: StaffLoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await apiPost<StaffLoginResponseBody>('/auth/staff-login', { email, password });
      if (result.outcome === 'rejected') {
        setError('Email o contraseña incorrectos.');
        return;
      }
      onLoggedIn({ userId: result.userId, role: result.role, barberId: result.barberId });
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="staff-login">
      <div className="staff-login__card">
        <span className="staff-login__brand">JC Barbería</span>
        <h2 className="staff-login__title">Ingreso de personal</h2>
        <p className="staff-login__hint">Acceso exclusivo para dueño, secretaria y barberos.</p>
        {sessionExpired && !error && (
          <p className="staff-login__notice" role="status">
            Tu sesión venció. Volvé a entrar para seguir.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <form onSubmit={handleSubmit}>
          <label htmlFor="staff-login-email">Email</label>
          <input
            id="staff-login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label htmlFor="staff-login-password">Contraseña</label>
          <input
            id="staff-login-password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button type="submit">Ingresar</button>
        </form>
        <p className="staff-login__recovery">¿No recordás tu contraseña? Pedísela al dueño del local.</p>
        {/* A client who lands here by mistake — this is the only screen in
            the app with no header — otherwise has no way back to the site
            except the browser's back button. */}
        <p className="staff-login__exit">
          <a href="/">¿Buscabas reservar un turno? Volvé al sitio</a>
        </p>
      </div>
    </div>
  );
}
