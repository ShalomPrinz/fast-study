import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// One flat config for every JS/TS surface in the repo — installed once at the
// root so `frontend/`, the Node packages, and the dependency-free extension all
// lint without four separate eslint installs. Rules stay at the recommended
// baseline (no-undef, no-unused-vars) because .claude/lint.sh runs this on every
// turn; type-aware rules are deliberately off, they need a full tsc pass.
// Three baseline rules are relaxed repo-wide: empty `catch {}` is the codebase's
// deliberate fire-and-forget idiom, unused *params* are load-bearing signatures
// (express's 4-arg error handler, overridable extractor hooks), and requiring an
// error `cause` on every rethrow is churn this code doesn't need.
const baseline = {
  ...js.configs.recommended.rules,
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': ['error', { args: 'none' }],
  'preserve-caught-error': 'off',
};

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', 'downloader/**/downloads/**'] },

  // Node packages: downloader server + auto-downloader, both ESM.
  {
    files: ['downloader/server/**/*.js', 'downloader/auto/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      // Extractors ship `page.evaluate(() => document…)` callbacks that run in
      // the browser context, so both global sets are legitimately in scope.
      globals: { ...globals.node, ...globals.browser },
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
    },
  },
];
