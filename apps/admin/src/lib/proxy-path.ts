/**
 * Path validation for the admin panel's API proxies.
 *
 * Both proxy routes forward a **browser-supplied path segment** to the API.
 * Forwarding that blindly would turn the admin panel into an open proxy into
 * the API's internal surface: a path like `/x/../../../../v1/admin/users`
 * escapes the intended `/v1/admin/content/…` prefix entirely, and the
 * `new URL(...)` normalisation in the API client resolves it before the
 * request is ever made.
 *
 * The defence is two-layered:
 *
 *  1. **Grammar** — every segment must match a conservative character set.
 *     A `.` or `..` segment does not match it, so relative segments cannot
 *     even be expressed.
 *  2. **Post-normalisation re-check** — the fully resolved upstream path is
 *     compared against the intended prefix. This catches anything the
 *     grammar missed, including percent-encoded traversal that a
 *     double-decode would reveal.
 *
 * The API remains the authority: every forwarded call still passes through
 * `requireAdmin` and `requirePermission`. This is a transport safeguard,
 * never a security boundary on its own.
 */

/** URL segments a proxied path may contain. */
const SEGMENT = /^[A-Za-z0-9._~%()~-]+$/;

/** Reserved characters that could be used to escape the intended prefix. */
const TRAVERSAL = /(^|[\\/])\.\.($|[\\/])|%2e%2e/i;

/** The maximum length of a forwarded path. */
const MAX_PATH_LENGTH = 300;

/**
 * True when the path is safe to append to a fixed API prefix.
 *
 * A path is safe when it is non-empty, within the length budget, free of
 * null bytes, free of traversal sequences (before *and* after decoding), and
 * composed entirely of segments that match the conservative grammar.
 */
export function isSafePath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (path.includes('\0')) return false;
  if (TRAVERSAL.test(path)) return false;

  // Reject anything that would be re-encoded as traversal once resolved.
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decoded !== path && TRAVERSAL.test(decoded)) return false;

  return path.split('/').every((segment) => segment === '' || SEGMENT.test(segment));
}

/**
 * Resolve a forwarded path against a fixed API prefix, or return `null` when
 * it would escape that prefix.
 *
 * The resolution is done with `new URL()`, because that is exactly what the
 * API client does — so the check and the request cannot disagree. If the
 * resolved path does not start with the prefix, the request is refused.
 *
 * The path is treated as **relative to the prefix directory**, so a leading
 * slash is stripped rather than being read as "the root of the origin".
 * `new URL('/homepage', 'http://x/v1/admin/content')` would otherwise
 * resolve to `/homepage`, not to `/v1/admin/content/homepage`.
 */
export function resolveProxiedPath(prefix: string, path: string): URL | null {
  if (!isSafePath(path)) return null;

  const normalisedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const base = new URL(normalisedPrefix, 'http://internal.invalid');

  // A leading slash means "relative to the prefix", not "the origin root".
  const relative = path.replace(/^\/+/, '');
  const resolved = new URL(relative, base);

  // The resolved path must still be inside the prefix.
  if (!resolved.pathname.startsWith(normalisedPrefix)) return null;

  return resolved;
}
