import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

// Only ShopClock is allowed to touch the machine clock directly. Every other
// module MUST go through the `Clock` port so time is testable and the fixed
// Argentina UTC-3 offset can never be bypassed by accident.
const noDirectClockAccess = {
  selector:
    "NewExpression[callee.name='Date'], CallExpression[callee.object.name='Date'][callee.property.name='now'], CallExpression[callee.property.name='toLocaleString']",
  message: 'Do not use Date.now()/new Date()/toLocaleString() directly — use the Clock port (ShopClock is the only allowed adapter).',
};

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        crypto: 'readonly',
        performance: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-restricted-syntax': ['error', noDirectClockAccess],
    },
  },
  {
    // ShopClock is the real adapter; FakeClock is its deterministic test
    // double for domain-level unit tests (domain must never import
    // packages/infrastructure). Both are the only places allowed to
    // construct Date directly.
    files: [
      'packages/infrastructure/src/shared/clock/shop-clock.ts',
      'packages/domain/src/shared/ports/testing/fake-clock.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // apps/web is the only package that runs IN a browser (every other
    // package is Node-only) — the arranque slice's pages are the first code
    // in this repo to touch these globals directly (every pre-existing
    // component is purely presentational, receiving data through props
    // instead), so nothing declared them before now. Scoped to this one
    // package on purpose: Node code getting `window`/`document`/`fetch` as
    // valid globals would just weaken `no-undef` there for no reason.
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        RequestInit: 'readonly',
        URLSearchParams: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
  {
    // Agent worktrees are whole copies of the repo living inside it. Linting
    // them reports every finding N+1 times and attributes it to a path that is
    // not the source of truth — the real file is linted on its own.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '.claude/**',
      '.opencode/**',
      'recon-*/**',
    ],
  },
  prettierConfig,
];
