import swc from 'unplugin-swc';
import { defineConfig } from 'vite';

// `vite-node` (the `dev`/`start` scripts) picks this up automatically, the
// same way Vitest picks up `vitest.config.ts` — reuses the exact same swc
// plugin `vitest.shared.ts` already proves compiles this app's NestJS
// decorator metadata correctly, so `main.ts` runs through the identical
// transform the test suite already exercises end-to-end (see
// `test/hold.spec.ts`, which boots the full `AppModule` DI graph).
export default defineConfig({
  plugins: [swc.vite()],
});
