import { useEffect, useState, type ReactNode } from 'react';
import type { AccountProfileResponse } from '@jc-barberia/contracts';

import { apiGet, apiPost } from '../shared/api-client';
import { Link, useRouter } from '../shared/router';
import './PublicLayout.css';

export interface PublicLayoutProps {
  readonly children: ReactNode;
}

const PUBLIC_NAV_ITEMS = [
  { path: '/', label: 'Inicio' },
  { path: '/reservar', label: 'Reservar turno' },
  { path: '/mi-cuenta', label: 'Mi cuenta' },
] as const;

/**
 * client-session-nav: a client's session lives in an httpOnly cookie the
 * browser sends on its own — this layout can never read it directly, only
 * ask `GET /account/profile` and see whether it comes back 200 (session) or
 * 403 (no session, the ordinary case for a first-time visitor), same
 * pattern `BookingPage` already uses for its own best-effort profile fetch.
 * `'unknown'` is the instant between mount and that answer: neither
 * "Ingresar" nor "Cerrar sesión" render then, so the nav gains exactly one
 * item once the answer is known instead of showing one and swapping it for
 * the other a moment later (`PublicLayout.spec.tsx` locks in both the
 * silent "unknown" state and the single settle).
 */
type SessionState = 'unknown' | 'guest' | 'client';

/**
 * D.2/D.4: the public site's shell. A visitor never sees anything about the
 * panel from here — no link, no mention of the word anywhere in this
 * component's own copy (`PublicLayout.spec.tsx` asserts exactly that). Kept
 * completely separate from `PanelLayout`: different nav source (a small
 * fixed list here, vs. `visiblePanelNavItems` there), different visual
 * register, nothing shared besides the design tokens in `styles/tokens.css`.
 *
 * client-session-nav: "Ingresar" only makes sense for a visitor with no
 * session — a client who is already logged in gets a "Cerrar sesión" action
 * instead, resolved via `SessionState` above.
 */
export function PublicLayout({ children }: PublicLayoutProps) {
  const { pathname, navigate } = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>('unknown');

  useEffect(() => {
    let cancelled = false;
    apiGet<AccountProfileResponse>('/account/profile')
      .then(() => {
        if (!cancelled) {
          setSessionState('client');
        }
      })
      .catch(() => {
        // 403 (no session, the ordinary case for a visitor) or any other
        // failure: either way this layout has nothing more specific to say,
        // so it falls back to the guest nav.
        if (!cancelled) {
          setSessionState('guest');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await apiPost('/auth/logout');
    } finally {
      // Same posture as `App.tsx`'s own staff logout: the cookie is gone
      // (or never was) either way, so the nav goes back to "Ingresar"
      // regardless of whether the request itself succeeded.
      setSessionState('guest');
      // And back to the home page: logging out while standing on
      // "Mi cuenta" used to leave that screen up, still listing the turnos
      // of the session just closed — from the outside it looked like the
      // button had done nothing. Navigating unmounts it.
      navigate('/');
    }
  }

  return (
    <div className="public-layout">
      <header className="public-layout__header">
        <Link to="/" className="public-layout__brand">
          JC Barbería
        </Link>
        <nav className="public-layout__nav" aria-label="Navegación">
          <ul>
            {PUBLIC_NAV_ITEMS.map((item) => (
              <li key={item.path}>
                <Link to={item.path} aria-current={pathname === item.path ? 'page' : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
            {sessionState === 'guest' && (
              <li>
                <Link to="/acceder" aria-current={pathname === '/acceder' ? 'page' : undefined}>
                  Ingresar
                </Link>
              </li>
            )}
            {sessionState === 'client' && (
              <li>
                <button type="button" onClick={handleLogout}>
                  Cerrar sesión
                </button>
              </li>
            )}
          </ul>
        </nav>
      </header>
      <main className="public-layout__content">{children}</main>
      <footer className="public-layout__footer">
        <div className="public-layout__footer-inner">
          <div>
            <strong>JC Barbería</strong>
            <p>Córdoba Capital, Argentina.</p>
          </div>
          <div>
            <strong>Horario</strong>
            <p>Lunes a sábado, 09:00 a 20:00. Domingo cerrado.</p>
          </div>
          <div>
            <strong>Turnos</strong>
            <p>Se reservan online con una seña del 50%.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
