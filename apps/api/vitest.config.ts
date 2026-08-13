import { defineConfig, mergeConfig } from 'vitest/config';

import shared from '../../vitest.shared';

// NestJS decorators (@Injectable, @SetMetadata, ...) need the
// `reflect-metadata` polyfill loaded before any decorated class is
// evaluated — normally main.ts's job, but this app has none yet (see
// app.module.ts's own doc comment). `setupFiles` guarantees it runs before
// every test file in this package, the same guarantee main.ts will give
// once it exists.
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      setupFiles: ['reflect-metadata'],
    },
  }),
);
