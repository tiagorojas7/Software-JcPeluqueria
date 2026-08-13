import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Deliberately does NOT `mergeConfig` over `../../vitest.shared` the way
// apps/api does. That file's top-level `import swc from 'unplugin-swc'`
// (built for NestJS decorator-metadata emission — irrelevant to plain React
// function components) is a hard, unconditional import: pnpm's isolated
// node_modules only resolves it for packages that declare it as a
// dependency, so merging over the shared config fails at config-load time
// for a package that never installs it — confirmed empirically (Vitest's
// own startup error: `ERR_MODULE_NOT_FOUND: unplugin-swc`) rather than
// assumed. Adding `unplugin-swc` as an unused dependency just to satisfy
// that import, or concatenating its plugin with @vitejs/plugin-react over
// the same .tsx files, are both worse than reproducing the two scalar
// `test` options this package actually shares with the rest of the
// monorepo directly below.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    passWithNoTests: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
