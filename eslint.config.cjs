// eslint.config.cjs (ESLint v9 flat config)
// Root-level config so `npx eslint .` works from the repo root.
// Tailored for a mixed repo with a Next.js app under `web/`.

/* eslint-env node */
const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  // 1) Ignore common output and virtual env folders
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/out/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.venv/**',
      '**/__pycache__/**',
      // Defer to Next.js project's own flat config under web/
      'web/**',
    ],
  },

  // 2) JavaScript defaults (ESLint recommended)
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...js.configs.recommended,
  },

  // 3) TypeScript rules (applies across the repo)
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // If you add a TS project at the repo root, point this to that tsconfig.
        // Currently disabled to avoid cross-project references.
        // project: ['./tsconfig.json'],
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // 4) Legacy browser scripts in sports-ai/frontend/scripts
  //    Mark browser globals to avoid no-undef for window/document/fetch/etc.
  {
    files: ['sports-ai/frontend/scripts/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        alert: 'readonly',
      },
      sourceType: 'script',
    },
  },
];
