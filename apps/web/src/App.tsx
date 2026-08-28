import { useEffect, useState } from 'react';

import { MyAccountPage } from './account/MyAccountPage';
import { PanelLayout } from './layout/PanelLayout';
import { PublicLayout } from './layout/PublicLayout';
import { resolvePanelRedirect } from './layout/panel-guard';
import { AccessCodePage } from './pages/AccessCodePage';
import { AdminDayBoardPage } from './pages/AdminDayBoardPage';
import { BarberDayBoardPage } from './pages/BarberDayBoardPage';
import { BookingPage } from './pages/BookingPage';
import { HomePage } from './pages/HomePage';
import { ManagementPage } from './pages/ManagementPage';
import { PaymentReturnPage } from './pages/PaymentReturnPage';
import { StaffActivationPage } from './pages/StaffActivationPage';
import { PhoneAppointmentPage } from './pages/PhoneAppointmentPage';
import { RevenuePage } from './pages/RevenuePage';
import { ShopRevenuePage } from './pages/ShopRevenuePage';
import { StaffLoginPage } from './pages/StaffLoginPage';
import { ErrorBoundary } from './shared/ErrorBoundary';
import { apiPost, onApiError } from './shared/api-client';
import { documentTitleFor } from './shared/document-title';
import { isSessionExpired } from './shared/session-expiry';
import type { Actor } from './shared/actor';
import { RouterProvider, useRouter } from './shared/router';
import { clearPersistedActor, loadPersistedActor, savePersistedActor } from './shared/session';

const PANEL_HOME_PATH = '/panel';

function NotFound() {
  return (
    <section className="container" style={{ padding: '64px 0', textAlign: 'center' }}>
      <h2>Página no encontrada</h2>
      <p>La página que buscás no existe o cambió de lugar.</p>
    </section>
  );
}

function renderPublicRoute(pathname: string) {
  switch (pathname) {
    case '/':
      return <HomePage />;
    case '/reservar':
      return <BookingPage />;
    case '/acceder':
      return <AccessCodePage />;
    case '/mi-cuenta':
      return <MyAccountPage />;
    case '/pago/retorno':
      return <PaymentReturnPage />;
    // Public on purpose, and NOT under `/panel`: whoever follows the
    // activation link has no session yet — routing it into the panel shell
    // would bounce them to the login they cannot pass.
    case '/personal/activar':
      return <StaffActivationPage />;
    default:
      return <NotFound />;
  }
}

function renderPanelRoute(pathname: string, actor: Actor) {
  switch (pathname) {
    case '/panel':
      return actor.role === 'barber' ? <BarberDayBoardPage actor={actor} /> : <AdminDayBoardPage actor={actor} />;
    case '/panel/turno-telefonico':
      return <PhoneAppointmentPage actor={actor} />;
    case '/panel/gestion':
      return <ManagementPage actor={actor} />;
    case '/panel/facturacion':
      return <RevenuePage actor={actor} />;
    case '/panel/facturacion-local':
      return <ShopRevenuePage actor={actor} />;
    default:
      return <NotFound />;
  }
}

/**
 * D.1/D.3/D.4: the split into two real applications. `pathname` decides
 * everything: under `/panel` the panel shell (`PanelLayout`) and its login
 * gate (`resolvePanelRedirect`) apply; everywhere else is the public site
 * (`PublicLayout`), which never renders a single panel link, route or word
 * (`PublicLayout.spec.tsx`/`HomePage.spec.tsx` both assert that directly).
 *
 * The redirect runs from an effect, not inline during render, so
 * `window.history` only changes as a reaction to a committed render — but
 * the render itself never shows protected content on the way there: every
 * branch below returns `null` or the login screen while a redirect is
 * pending, exactly what `resolvePanelRedirect` decided.
 */
function AppShell() {
  const { pathname, navigate } = useRouter();
  const [actor, setActor] = useState<Actor | null>(() => loadPersistedActor());
  /** Set when the session turned out to be gone, so the login screen can say
   *  why instead of looking like a random logout. */
  const [sessionExpired, setSessionExpired] = useState(false);

  // The persisted actor survives a refresh, but the httpOnly cookie that
  // actually authorises anything expires on its own — and nothing noticed.
  // The panel kept rendering as if logged in while every section answered
  // "No authenticated actor for this request.", which is the API saying
  // exactly this, to someone who should never have to read it. One listener
  // here, rather than the same check copied into every screen.
  useEffect(() => {
    return onApiError((error) => {
      if (!isSessionExpired(error)) {
        return;
      }
      clearPersistedActor();
      setActor(null);
      setSessionExpired(true);
    });
  }, []);

  useEffect(() => {
    const redirect = resolvePanelRedirect(pathname, actor);
    if (redirect) {
      navigate(redirect);
    }
  }, [pathname, actor, navigate]);

  // `index.html` carries one static <title> for all eleven sections; this is
  // the only place that keeps the tab honest about where the visitor is.
  useEffect(() => {
    document.title = documentTitleFor(pathname);
  }, [pathname]);

  async function handleLogout() {
    try {
      await apiPost('/auth/logout');
    } finally {
      clearPersistedActor();
      setActor(null);
    }
  }

  function handleLoggedIn(loggedInActor: Actor) {
    savePersistedActor(loggedInActor);
    setActor(loggedInActor);
    setSessionExpired(false);
    navigate(PANEL_HOME_PATH);
  }

  const isPanelPath = pathname === '/panel' || pathname.startsWith('/panel/');

  if (isPanelPath) {
    if (pathname === '/panel/login') {
      if (actor) {
        // Already logged in — the effect above is redirecting to the panel
        // home; render nothing meanwhile instead of a dead login form.
        return null;
      }
      return <StaffLoginPage onLoggedIn={handleLoggedIn} sessionExpired={sessionExpired} />;
    }
    if (!actor) {
      // The effect above is redirecting to `/panel/login`; render nothing
      // meanwhile so protected content never flashes on screen.
      return null;
    }
    return (
      <PanelLayout actor={actor} onLogout={handleLogout}>
        {renderPanelRoute(pathname, actor)}
      </PanelLayout>
    );
  }

  return <PublicLayout>{renderPublicRoute(pathname)}</PublicLayout>;
}

export function App() {
  return (
    <ErrorBoundary>
      <RouterProvider>
        <AppShell />
      </RouterProvider>
    </ErrorBoundary>
  );
}
