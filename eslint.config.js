import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// One flat config for every JS/TS surface in the repo — installed once at the
// root so `frontend/`, the Node packages, and the dependency-free extension all
// lint without four separate eslint installs. Rules stay at the recommended
// baseline (no-undef, no-unused-vars) because .claude/lint.sh runs this on every
// turn; type-aware rules are deliberately off, they need a full tsc pass.
// Empty `catch {}` is the codebase's deliberate fire-and-forget idiom, and requiring an
// error `cause` on every rethrow is churn this code doesn't need. A load-bearing unused
// name (express's 4-arg error handler, an overridable extractor hook) takes a `_` prefix.
const unusedVars = {
  args: 'after-used',
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrorsIgnorePattern: '^_',
  destructuredArrayIgnorePattern: '^_',
};

const baseline = {
  ...js.configs.recommended.rules,
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': ['error', unusedVars],
  'no-unused-private-class-members': 'error',
  'no-useless-assignment': 'error',
  'preserve-caught-error': 'off',
};

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', 'downloader/**/downloads/**'] },

  // Node packages: downloader server + auto-downloader, both ESM.
  {
    files: [
      'downloader/server/**/*.js',
      'downloader/auto/**/*.js',
      'lib/**/*.js',
      'eslint.config.js',
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      // Extractors ship `page.evaluate(() => document…)` callbacks that run in
      // the browser context, so both global sets are legitimately in scope.
      globals: { ...globals.node, ...globals.browser },
    },
    rules: baseline,
  },

  // The app harness and the bug hunt on it under .claude/: agent tooling, ESM on Node, never shipped.
  {
    files: ['.claude/{harness,hunt-bugs}/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: baseline,
  },

  // Release smoke suite: ESM on Node, with `page.evaluate` callbacks that run in the app's renderer.
  {
    files: ['delivery/smoke/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: baseline,
  },

  // Electron launcher: CommonJS, because a sandboxed preload script cannot be ESM and
  // splitting one small package across both module systems buys nothing.
  {
    files: ['electron/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: baseline,
  },

  // The launch screen's script: the one file in electron/ that runs in a renderer, as a classic
  // script on a file:// page, with only the preload bridge to reach main.
  {
    files: ['electron/boot.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: baseline,
  },

  // Chrome extension: classic scripts (MV3 service worker + popup), no bundler.
  {
    files: ['downloader/extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, chrome: 'readonly' },
    },
    rules: baseline,
  },

  // Frontend: tsc owns undefined names and types, so eslint only carries the
  // unused-symbol and obvious-mistake rules.
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ['frontend/**/*.ts', 'frontend/**/*.tsx'],
  })),
  {
    files: ['frontend/**/*.ts', 'frontend/**/*.tsx'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', unusedVars],
      'no-unused-private-class-members': 'error',
      'no-useless-assignment': 'error',
    },
  },
];
