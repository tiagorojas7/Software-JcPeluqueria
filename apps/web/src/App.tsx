import { useEffect, useState } from 'react';

import { MyAccountPage } from './account/MyAccountPage';
import { AccessCodePage } from './pages/AccessCodePage';
import { AdminDayBoardPage } from './pages/AdminDayBoardPage';
import { BarberDayBoardPage } from './pages/BarberDayBoardPage';
import { BookingPage } from './pages/BookingPage';
import { PhoneAppointmentPage } from './pages/PhoneAppointmentPage';
import { RevenuePage } from './pages/RevenuePage';
import { StaffLoginPage } from './pages/StaffLoginPage';
import { apiPost } from './shared/api-client';
import type { Actor } from './shared/actor';

const ROUTES = [
  { path: 'booking', label: 'Reservar turno (web pública)' },
  { path: 'access-code', label: 'Ingresar con código (cliente)' },
  { path: 'my-account', label: 'Mi cuenta (cliente)' },
  { path: 'staff-login', label: 'Ingreso de personal' },
  { path: 'admin-day-board', label: 'Agenda del día (admin)' },
  { path: 'barber-day-board', label: 'Mi agenda (barbero)' },
  { path: 'phone-appointment', label: 'Turno telefónico (panel)' },
  { path: 'revenue', label: 'Mi facturación (barbero)' },
] as const;

type Route = (typeof ROUTES)[number]['path'];

function currentRoute(): Route {
  const hash = window.location.hash.replace('#', '');
  return ROUTES.find((r) => r.path === hash)?.path ?? 'booking';
}

/**
 * Minimal nav so a human can walk between the demo's screens (arranque
 * slice — plain hash-based navigation, no router library: every screen is
 * one flat list, none of it needs nested/parameterized routes). Owns the
 * one piece of cross-page state every screen after login needs — `actor` —
 * so `StaffLoginPage` sets it once and every other panel screen reads it
 * back without re-fetching who is logged in.
 */
export function App() {
  const [route, setRoute] = useState<Route>(currentRoute());
  const [actor, setActor] = useState<Actor | null>(null);

  useEffect(() => {
    function onHashChange() {
      setRoute(currentRoute());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  async function handleLogout() {
    try {
      await apiPost('/auth/logout');
    } finally {
      setActor(null);
    }
  }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <header>
        <h1>JC Barbería — demo del turnero</h1>
        <p>
          {actor
            ? `Sesión activa: ${actor.role}${actor.barberId ? ` (barbero ${actor.barberId})` : ''}. `
            : 'Sin sesión de personal — algunas pantallas lo requieren. '}
          {actor && (
            <button type="button" onClick={handleLogout}>
              Salir
            </button>
          )}
        </p>
        <nav>
          <ul style={{ display: 'flex', gap: 12, flexWrap: 'wrap', listStyle: 'none', padding: 0 }}>
            {ROUTES.map((r) => (
              <li key={r.path}>
                <a href={`#${r.path}`} aria-current={route === r.path ? 'page' : undefined}>
                  {r.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <hr />
      </header>
      <main>
        {route === 'booking' && <BookingPage />}
        {route === 'access-code' && <AccessCodePage />}
        {route === 'my-account' && <MyAccountPage />}
        {route === 'staff-login' && <StaffLoginPage onLoggedIn={setActor} />}
        {route === 'admin-day-board' && <AdminDayBoardPage actor={actor} />}
        {route === 'barber-day-board' && <BarberDayBoardPage actor={actor} />}
        {route === 'phone-appointment' && <PhoneAppointmentPage actor={actor} />}
        {route === 'revenue' && <RevenuePage actor={actor} />}
      </main>
    </div>
  );
}
