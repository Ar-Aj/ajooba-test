import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Shared ESLint flat config for every workspace package.
 *
 * Type-aware linting is enabled deliberately: the contracts package is the
 * backbone of the platform and its types must be sound.
 *
 * The `no-unsafe-*` rules are disabled because they fire on any expression
 * whose type is inferred from a generic (Zod schemas are generic-heavy), which
 * produces noise rather than signal. The valuable rules — `no-explicit-any`,
 * `no-floating-promises`, `no-misused-promises` — remain on.
 */
export const baseConfig = tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // `eslint.config.js` is deliberately NOT in `tsconfig.json`: this
          // package does not enable `allowJs`, so TypeScript would drop the
          // file from the program anyway. Listing it here is the only way the
          // project service will type-check it.
          //
          // `vitest.config.ts` IS part of the tsconfig, so it must NOT be
          // listed here — the project service rejects a file that is both in
          // the program and in `allowDefaultProject`.
          allowDefaultProject: ['eslint.config.js'],
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
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  prettier,
);

export default baseConfig;