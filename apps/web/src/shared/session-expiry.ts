import { ApiError } from './api-client';

/**
 * Whether an error means "your session is gone", as opposed to "you are not
 * allowed to do that".
 *
 * The panel keeps the logged-in actor in `localStorage` so a refresh does
 * not bounce staff back to the login screen. That cache is deliberately not
 * a source of authority — but nothing ever noticed when the real authority,
 * the httpOnly cookie, expired underneath it. The screen kept rendering as
 * if logged in while every call failed with `No authenticated actor for
 * this request.`, which is the API telling us exactly that, in words nobody
 * at a barbershop should ever have to read.
 *
 * The distinction from a permission denial matters: the secretary asking
 * for something only the owner may do gets a 403 too, and logging her out
 * over it would throw her out for a click she was simply not allowed to
 * make. `PermissionsGuard` phrases the two differently — a missing actor
 * says so, a missing permission names the role and the permission — and
 * that phrasing is what this reads.
 */
const NO_ACTOR_MESSAGE = 'no authenticated actor';

export function isSessionExpired(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  if (error.status === 401) {
    return true;
  }
  if (error.status !== 403) {
    return false;
  }
  const message = (error.body as { message?: unknown })?.message;
  return typeof message === 'string' && message.toLowerCase().includes(NO_ACTOR_MESSAGE);
}
