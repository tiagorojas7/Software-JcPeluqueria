import type { Actor } from './actor';

/**
 * Persists the logged-in staff `Actor` across a page refresh (D.1). The
 * session's actual authority is the httpOnly cookie `AuthController` sets
 * (`SESSION_COOKIE_NAME`) — this file never touches it and cannot, by
 * design. What it persists is the exact small, non-sensitive JSON
 * `StaffLoginResponseBody`'s `authenticated` branch already sends over the
 * wire (`userId`/`role`/`barberId`) so the panel knows WHICH screens/nav to
 * render again after a refresh without forcing a re-login purely for a UX
 * reason. If the cookie is missing or expired, the first API call this
 * actor's screen makes still fails with 401/403 exactly as it does today —
 * this is a convenience cache, never a second source of authority.
 */
const STORAGE_KEY = 'jc-barberia:staff-actor';

const ROLES = new Set(['owner', 'secretary', 'barber']);

function isActor(value: unknown): value is Actor {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.userId === 'string' &&
    typeof candidate.role === 'string' &&
    ROLES.has(candidate.role) &&
    (candidate.barberId === null || typeof candidate.barberId === 'string')
  );
}

/**
 * Every storage touch is wrapped, not just the JSON.parse: Safari in private
 * mode (and any browser with site data blocked) throws on the ACCESS itself,
 * and `loadPersistedActor` runs synchronously inside App.tsx's initial
 * `useState` — an unguarded throw there is a blank page before the first
 * render. Same posture `AccessCodePage` applies to its own key: the only
 * degradation is having to log in again.
 */
export function loadPersistedActor(): Actor | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isActor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePersistedActor(actor: Actor): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(actor));
  } catch {
    // Nothing to degrade to — the next refresh just asks for a login again.
  }
}

export function clearPersistedActor(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // If storage is unreachable there is nothing persisted to clear anyway.
  }
}
