import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'dist/**',
      'dist-single/**',
      'coverage/**',
      'assets/**',
      'playwright-report/**',
      'test-results/**',
      'RobotWarrior.html',
      '.migration/**',
    ],
  },

  js.configs.recommended,

  // Game source: runs in the browser, authored as ES modules.
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // The simulation is a hot loop: short names and terse math are intentional
      // here, but genuinely dead code is still a bug worth failing on.
      //
      // Two exemptions, both load-bearing in this codebase: optional browser
      // features are probed with `try { ... } catch (e) {}`, and `_` marks a
      // deliberately discarded element when destructuring a wire message.
      'no-unused-vars': [
        'error',
        {
          args: 'none',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      // An empty catch is how the game degrades when storage or an API is absent.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-undef': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-implicit-globals': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-throw-literal': 'error',
      'require-atomic-updates': 'off',
    },
  },

  // Build scripts and config: Node.
  {
    files: ['scripts/**/*.mjs', '*.config.js', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Unit tests: Node + Vitest.
  {
    files: ['tests/unit/**/*.test.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { 'no-console': 'off' },
  },

  // End-to-end tests: Node, but the page-evaluated callbacks reference browser globals.
  {
    files: ['tests/e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { 'no-console': 'off' },
  },

  prettier,
];
