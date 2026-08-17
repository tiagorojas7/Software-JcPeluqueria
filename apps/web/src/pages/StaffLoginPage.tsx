import { useState, type FormEvent } from 'react';
import type { StaffLoginResponseBody } from '@jc-barberia/contracts';

import { apiPost, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';

export interface StaffLoginPageProps {
  readonly onLoggedIn: (actor: Actor) => void;
}

/**
 * Not one of the 11 pre-existing components — `apps/web` never had a login
 * screen because the API never had a login ROUTE either (see
 * `apps/api/src/identity/auth.controller.ts`'s doc comment). Deliberately
 * minimal: this is the arranque slice's own addition, not a spec'd screen.
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
    <section>
      <h2>Ingreso de personal</h2>
      <p>Credenciales de la demo en docs/DEMO.md (dueño, secretaria o barbero).</p>
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
    </section>
  );
}
