import type { Actor } from '../shared/actor';

const PANEL_LOGIN_PATH = '/panel/login';
const PANEL_HOME_PATH = '/panel';

function isPanelPath(pathname: string): boolean {
  return pathname === '/panel' || pathname.startsWith('/panel/');
}

/**
 * D.1's login-gate as one pure decision, kept out of `App.tsx`'s JSX so it
 * is trivially testable on its own: "el panel exige sesion; sin ella
 * redirige al login, nunca muestra la pantalla vacia" (tasks.md). Returns
 * the path to redirect to, or `null` when the current `pathname` should
 * just render as-is. The public site (`/`, `/reservar`, ...) is never
 * touched by this guard at all — only `/panel` and everything under it.
 */
export function resolvePanelRedirect(pathname: string, actor: Actor | null): string | null {
  if (!isPanelPath(pathname)) {
    return null;
  }
  const isLoginPath = pathname === PANEL_LOGIN_PATH;
  if (!actor) {
    return isLoginPath ? null : PANEL_LOGIN_PATH;
  }
  return isLoginPath ? PANEL_HOME_PATH : null;
}
