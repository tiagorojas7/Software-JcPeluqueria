import { useState, type FormEvent } from 'react';
import type { StaffLoginResponseBody } from '@jc-barberia/contracts';

import { apiPost, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';
import './StaffLoginPage.css';

export interface StaffLoginPageProps {
  readonly onLoggedIn: (actor: Actor) => void;
}

/**
 * The panel's own entry point (D.1): rendered standalone at `/panel/login`,
 * never inside `PanelLayout` — there is no `Actor` yet to give it. Alta y
 * reseteo de personal quedan fuera de alcance a propósito (tasks.md, "Fuera
 * de alcance, explícito"): el mensaje de recuperación dirige a hablar con el
 * dueño en vez de prometer un flujo que no existe.
 */
export function StaffLoginPage({ onLoggedIn }: StaffLoginPageProps) {
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
      </div>
    </div>
  );
}
