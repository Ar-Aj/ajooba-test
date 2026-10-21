/**
 * Test environment bootstrap.
 *
 * `src/lib/env.ts` validates `process.env` at module load and throws on a bad
 * configuration — which is the behaviour we want in production and the wrong
 * behaviour in a unit test. These values mirror `apps/storefront/.env.example`
 * exactly, so the tests exercise the real validation path.
 *
 * `Object.assign` is used because Next.js types `NODE_ENV` as a read-only
 * property of `process.env`.
 *
 * Nothing here is a secret and nothing here is a production URL.
 */

Object.assign(process.env, {
  NODE_ENV: 'test',
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
  API_INTERNAL_URL: 'http://localhost:4000',
  NEXT_PUBLIC_API_URL: 'http://localhost:4000',
  NEXT_PUBLIC_MEDIA_BASE_URL: '/',
  CATALOG_REVALIDATE_SECONDS: '300',
});
