/** The cookie a session id travels in (design.md: "cookie httpOnly+Secure
 *  +SameSite=Lax con id opaco contra tabla `sessions`"). Setting this
 *  cookie on login is a later phase's job (no login HTTP endpoint exists
 *  yet); this constant is the one place both that future code and
 *  `ActorContextMiddleware` must agree on the name. */
export const SESSION_COOKIE_NAME = 'session_id';

/**
 * Minimal structural shape of what a handler/guard needs from the platform
 * response object (`res.cookie`/`res.clearCookie`, both real Express methods
 * since `@nestjs/platform-express` is the adapter this app already uses) —
 * deliberately NOT `import type { Response } from 'express'`: `express` is
 * only a transitive dependency here (via `@nestjs/platform-express`), and
 * pnpm's strict linking does not expose transitive packages to this app's
 * own imports. A structural type avoids adding a direct dependency for
 * types alone.
 */
export interface CookieResponse {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string): void;
}

/**
 * The one place that writes the session cookie's wire attributes —
 * originally duplicated across `AuthController.login`/`clientLogin`, now
 * also used by `PermissionsGuard` (cuenta-cliente-persistente: it re-issues
 * this cookie on every authenticated client request so a rolling-session
 * renewal in the DB is never left behind by a browser cookie still carrying
 * the OLD expiry — see `ClientContextRepository.resolveBySessionId`'s own
 * doc comment).
 */
export function writeSessionCookie(res: CookieResponse, sessionId: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    // Secure cookies require HTTPS — the demo runs the API over plain
    // HTTP on localhost, so this only turns on for a real deployment.
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
  });
}

/**
 * Reads a single cookie's value out of a raw `Cookie` request header. No
 * `cookie-parser` dependency for one field — this app has no `main.ts` yet
 * to install it on (see app.module.ts), and every cookie this app currently
 * cares about is this one.
 */
export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const pair of cookieHeader.split(';')) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const name = pair.slice(0, separatorIndex).trim();
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(pair.slice(separatorIndex + 1).trim());
    }
  }
  return undefined;
}
