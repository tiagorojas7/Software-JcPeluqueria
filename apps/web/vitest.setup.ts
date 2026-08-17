import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// `test.globals` stays `false` monorepo-wide (see vitest.shared.ts), so
// Testing Library's own auto-cleanup — which only registers itself when it
// finds a global `afterEach` — never fires on its own. Doing it explicitly
// here is the one place this package needs to know that.
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
