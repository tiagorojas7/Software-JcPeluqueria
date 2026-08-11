import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Shared by every package's vitest.config.ts. swc is required so Vitest can
// compile TypeScript decorator metadata the same way ts-node/Nest expect,
// keeping one runner and one config shape across the whole monorepo.
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: false,
    passWithNoTests: true,
  },
});
