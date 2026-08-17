import swc from 'unplugin-swc';
import { defineConfig } from 'vite';

// `vite-node` (the `db:seed` script) picks this up automatically. This
// package's own decorator-free, but the same swc plugin `vitest.shared.ts`
// uses keeps one runner/config shape across the monorepo rather than a
// second, subtly different transform just for this one script.
export default defineConfig({
  plugins: [swc.vite()],
});
