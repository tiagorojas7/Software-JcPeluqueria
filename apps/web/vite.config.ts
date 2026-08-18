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
    proxy: {
      '/api': { target: process.env.VITE_API_ORIGIN ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
});
