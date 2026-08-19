import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// One prefix, one rule. `apps/api` serves everything under `/api`
// (`app.setGlobalPrefix`), so the SPA keeps every other path for its own
// routes — previously the proxy listed each controller prefix individually
// and `/panel` matched BOTH the API's panel controller and the web app's
// panel route, so opening the panel returned a 404 JSON body.
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind every interface, not just loopback. The barbershop's clients book
    // from their phones, so the dev server has to be reachable from another
    // device on the same network to test the real thing. `/api` still proxies
    // to the API over loopback from THIS machine, so the phone only ever
    // talks to one origin and CORS never engages.
    host: true,
    proxy: {
      '/api': { target: process.env.VITE_API_ORIGIN ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
});
