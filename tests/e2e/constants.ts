/**
 * Shared constants for the end-to-end suite.
 *
 * The ports live here rather than being repeated across the setup and the
 * specs, so a change to one cannot silently leave the other pointing at the
 * wrong process.
 */

/** The API's port. */
export const API_PORT = 4200;

/** The storefront's port. */
export const STOREFRONT_PORT = 3100;

/** The admin panel's port. */
export const ADMIN_PORT = 3101;

/**
 * The storefront's port for the **error-recovery** instance.
 *
 * This second storefront is started with an `API_INTERNAL_URL` that points at
 * a port nothing is listening on, so the catalogue API is genuinely
 * unreachable for it.
 *
 * It exists because the catalogue is rendered by a **server component**. The
 * storefront fetches the catalogue from the Next.js server, not from the
 * browser, so a Playwright `page.route()` abort — which only intercepts
 * browser requests — cannot make the API "unreachable" for a catalogue page.
 *
 * Starting a second instance is the only way to exercise that state against
 * the real production build. It reuses the **same build output** as the main
 * storefront, so it costs one extra process and no extra build.
 *
 * `API_INTERNAL_URL` is read at *runtime* by the server bundle (unlike the
 * `NEXT_PUBLIC_*` variables, which are inlined at build time), so the same
 * build can be pointed at a dead origin simply by starting it with a
 * different environment.
 */
export const DEAD_STOREFRONT_PORT = 3102;

/** The origin of the API. */
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;

/** The origin of the storefront. */
export const STOREFRONT_ORIGIN = `http://127.0.0.1:${STOREFRONT_PORT}`;

/** The origin of the admin panel. */
export const ADMIN_ORIGIN = `http://127.0.0.1:${ADMIN_PORT}`;

/** The origin of the error-recovery storefront instance. */
export const DEAD_STOREFRONT_ORIGIN = `http://127.0.0.1:${DEAD_STOREFRONT_PORT}`;

/**
 * The port the error-recovery instance points its API at.
 *
 * Nothing listens here, so every catalogue request from that instance fails
 * at the network level — exactly like an API outage.
 */
export const DEAD_API_PORT = 4299;

/** The administrator the global setup seeds. */
export const ADMIN_EMAIL = 'e2e-admin@example.test';

/** The administrator's password. Only ever valid against a throwaway database. */
export const ADMIN_PASSWORD = 'E2ePassword!2026';
