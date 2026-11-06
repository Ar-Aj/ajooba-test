import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Config/test-harness files are outside the type-checked project.
          allowDefaultProject: ['eslint.config.js', 'vitest.config.ts', 'vitest.setup.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    /*
     * Operational jobs and maintenance scripts are command-line tools whose
     * entire purpose is to print a human-readable report: dry-run summaries,
     * import plans, index reconciliation, migration results. They are not
     * request handlers, so the `no-console` rule that protects the API
     * surface does not apply — these processes have no other output channel,
     * and forcing a logger here would only make the reports harder to read
     * in a terminal.
     */
    files: ['src/jobs/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    /*
     * Test doubles that stand in for a network transport.
     *
     * A `fetch` stub is `async` because the real `fetch` is a promise, and
     * the code under test awaits it. It frequently contains no `await` of its
     * own — it resolves synchronously with a canned response. Removing the
     * `async` would change the mock's return type from a promise to a plain
     * object and break the stub's whole purpose, so the rule is wrong here
     * rather than the code being wrong.
     */
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
  prettier,
);
