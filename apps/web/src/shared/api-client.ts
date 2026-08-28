/**
 * Every call here uses a RELATIVE path (`/availability`, `/holds`, ...) so
 * it goes through Vite dev server's proxy (`apps/web/vite.config.ts`) to the
 * API on the SAME origin the browser sees — no CORS round-trip for the
 * actual demo, and `Set-Cookie`/`Cookie` just travel like any other
 * same-origin request. `credentials: 'include'` is kept anyway so a build
 * pointed straight at the API (no proxy) still carries the session cookie.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`);
    this.name = 'ApiError';
  }
}

/**
 * Every `ApiError` this module throws is also announced here, so ONE place
 * can react to a whole class of failure without each of the ~20 call sites
 * growing its own copy of the same check. The listener decides what the
 * error means — this module only reports that one happened, which is what
 * keeps it from having to know anything about sessions or routing.
 */
type ApiErrorListener = (error: ApiError) => void;

const apiErrorListeners = new Set<ApiErrorListener>();

/** Returns the unsubscribe function, so an effect can clean up after itself. */
export function onApiError(listener: ApiErrorListener): () => void {
  apiErrorListeners.add(listener);
  return () => {
    apiErrorListeners.delete(listener);
  };
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Every API route is served under this prefix (`app.setGlobalPrefix` in
 *  `apps/api/src/main.ts`). Prepending it here, in the single place requests
 *  are built, keeps every caller writing plain paths like `/agenda/day-board`
 *  and keeps the proxy rule down to one entry. */
const API_PREFIX = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await parseBody(res);
  if (!res.ok) {
    const error = new ApiError(res.status, body);
    // Announced BEFORE throwing so a listener sees every failure, including
    // the ones a caller catches and turns into its own on-screen message.
    for (const listener of apiErrorListeners) {
      listener(error);
    }
    throw error;
  }
  return body as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, payload?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: payload === undefined ? undefined : JSON.stringify(payload) });
}

export function apiPut<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(payload) });
}

/** No body by design: the only DELETE this app makes identifies its target
 *  entirely by path. */
export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

/** Best-effort human-readable message out of whatever an `ApiError` (or any
 *  other thrown value) carries — every page shows API failures the same way. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body;
    if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
      return body.message;
    }
    return `Error ${error.status}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Error desconocido';
}
