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
    files: ['packages/infrastructure/src/shared/clock/shop-clock.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  prettierConfig,
];
