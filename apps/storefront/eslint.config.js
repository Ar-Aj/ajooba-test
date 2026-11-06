import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * ESLint flat config for the storefront.
 *
 * `eslint-config-next` supplies the React and Next.js rules; `prettier` runs
 * last so that formatting conflicts never fail the lint step.
 *
 * The Next.js and React Hooks plugins are registered explicitly rather than
 * relying on `eslint-config-next` to do it, because that package's flat-config
 * entry point does not register the plugin *rules* in a way that survives
 * `tseslint.config()`'s composition — which produced "Definition for rule
 * '@next/next/no-img-element' was not found" at lint time.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-e2e/**',
      '**/coverage/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      /*
       * Catalogue images are served as static assets from the media origin
       * (`NEXT_PUBLIC_MEDIA_BASE_URL`), which is not necessarily the same
       * origin as the app. `next/image` would need a remote loader and a
       * configured `remotePatterns` for every deployment target, and the
       * source files are already per-design, correctly-sized JPEGs.
       *
       * The images are therefore rendered with plain `<img>` plus explicit
       * `width`/`height`/`loading`/`decoding` attributes, which is the
       * correct pattern for externally-hosted, pre-sized assets. Turn this
       * rule back on if the media origin is ever moved behind next/image.
       */
      '@next/next/no-img-element': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The service worker is a plain browser script rather than part of the
    // React application, so it is linted against the ServiceWorker global
    // scope instead of the browser window scope.
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-restricted-globals': 'off',
    },
  },
  prettier,
);
