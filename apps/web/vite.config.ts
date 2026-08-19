import { URL, fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The repository root, where the single `.env` lives (the API, the worker,
// the migrator and the seed all read that same file — see
// `packages/infrastructure/src/config/load-env.ts`). Vite's own `loadEnv`
// is used rather than `dotenv` so this config keeps zero extra dependencies;
// the empty prefix loads every key, not just `VITE_*`, because the two keys
// read below are plain server-side settings and never reach the browser.
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// One prefix, one rule. `apps/api` serves everything under `/api`
// (`app.setGlobalPrefix`), so the SPA keeps every other path for its own
// routes — previously the proxy listed each controller prefix individually
// and `/panel` matched BOTH the API's panel controller and the web app's
// panel route, so opening the panel returned a 404 JSON body.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, REPO_ROOT, ''), ...process.env };

  return {
    plugins: [react()],
    server: {
      // Bind every interface, not just loopback. The barbershop's clients
      // book from their phones, so the dev server has to be reachable from
      // another device on the same network to test the real thing. `/api`
      // still proxies to the API over loopback from THIS machine, so the
      // phone only ever talks to one origin and CORS never engages.
      host: true,
      // Vite rejects requests whose Host header it does not recognise, which
      // blocks any tunnel (ngrok) placed in front of it. The public host is
      // not known ahead of time, so it comes from `PUBLIC_BASE_URL` — the
      // same value the API puts in MercadoPago's `back_urls`, so there is
      // one source of truth for "where this deployment is publicly
      // reachable". Unset, only localhost and the LAN address are accepted,
      // which is the safer default.
      allowedHosts: publicHostOf(env.PUBLIC_BASE_URL),
      proxy: {
        '/api': { target: env.VITE_API_ORIGIN ?? 'http://localhost:3000', changeOrigin: true },
      },
    },
  };
});

/** The hostname `PUBLIC_BASE_URL` points at, as a one-element allow-list —
 *  or an empty list when it is unset or not a URL, so a typo degrades to the
 *  safe default instead of opening the dev server to any Host header. */
function publicHostOf(publicBaseUrl: string | undefined): string[] {
  if (!publicBaseUrl) {
    return [];
  }
  try {
    return [new URL(publicBaseUrl).hostname];
  } catch {
    return [];
  }
}
