/**
 * Prefix a browser-facing route with the admin app's Vercel base path.
 *
 * Next.js applies basePath to Link and router navigation, but plain fetch and
 * HTML form actions need the prefix added explicitly.
 */
const adminBasePath = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH ?? '';

export function adminPath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  return adminBasePath + normalizedPath;
}
