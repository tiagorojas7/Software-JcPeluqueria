import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Proxies every path prefix `apps/api`'s controllers actually use — checked
// against their `@Controller(...)` decorators, this API has no global `/v1`
// prefix — to the API dev server, so the browser only ever talks to ONE
// origin and CORS never has to engage for the demo itself (`apps/api/src/main.ts`'s
// CORS config stays as the fallback for anyone hitting the API directly).
const API_PROXY_PATHS = ['/availability', '/holds', '/agenda', '/appointments', '/barbers', '/panel', '/webhooks', '/auth'];

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      API_PROXY_PATHS.map((path) => [
        path,
        { target: process.env.VITE_API_ORIGIN ?? 'http://localhost:3000', changeOrigin: true },
      ]),
    ),
  },
});
