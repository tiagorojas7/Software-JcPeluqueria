import swc from 'unplugin-swc';
import { defineConfig } from 'vite';

// `vite-node` (the `dev`/`start` scripts) picks this up automatically.
// `main.ts` has no NestJS decorators, but every `@jc-barberia/*` workspace
// package it imports ships raw TypeScript source with no build step, so a
// real transform is still required — same swc plugin `vitest.shared.ts`
// already uses, kept as one runner/config shape across the monorepo.
export default defineConfig({
  plugins: [swc.vite()],
});
