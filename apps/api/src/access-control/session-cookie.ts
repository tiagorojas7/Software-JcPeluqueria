/** The cookie a session id travels in (design.md: "cookie httpOnly+Secure
 *  +SameSite=Lax con id opaco contra tabla `sessions`"). Setting this
 *  cookie on login is a later phase's job (no login HTTP endpoint exists
 *  yet); this constant is the one place both that future code and
 *  `ActorContextMiddleware` must agree on the name. */
export const SESSION_COOKIE_NAME = 'session_id';

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
