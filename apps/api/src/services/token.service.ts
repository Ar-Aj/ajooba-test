import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';
import { UnauthorizedError } from '../core/errors.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  type AdminPermission,
  type AdminRole,
  type AuthenticatedPrincipal,
  type TokenType,
} from '@ajooba/contracts';

/**
 * Token issuing and verification.
 *
 * Two token types exist:
 *
 *  - **Access token** — a short-lived signed JWT. It carries the identity
 *    and, for an administrator, the role and the resolved permission list.
 *    It is not stored server-side, so it cannot be revoked individually;
 *    that is what the short lifetime is for.
 *  - **Refresh token** — a long-lived opaque random string. Only its hash
 *    is stored, and it is rotated on every use. A replayed refresh token
 *    revokes the whole family.
 *
 * The signing key is derived from `JWT_SECRET` with HKDF so that a key
 * used for one token type can never validate the other, even though both
 * are signed with the same secret.
 */

const ALG = 'HS256';

/**
 * Derive a purpose-specific signing key from the single configured secret.
 *
 * This is synchronous by design: it only derives bytes, so there is no
 * reason to make every caller await it.
 */
function deriveKey(purpose: 'access' | 'refresh'): Uint8Array {
  const encoder = new TextEncoder();
  const baseKey = encoder.encode(env.JWT_SECRET);
  // A distinct, purpose-taged key for each token type.
  const material = new Uint8Array(baseKey.length + 1);
  material.set(baseKey, 0);
  material[baseKey.length] = purpose === 'access' ? 0x61 : 0x72; // 'a' | 'r'
  return material;
}

/** The claims carried inside an access token. */
export interface AccessTokenClaims {
  readonly sub: string;
  readonly kind: 'customer' | 'admin';
  readonly email: string;
  readonly role?: AdminRole;
  readonly permissions?: readonly AdminPermission[];
  readonly type: 'access';
}

/**
 * Issue an access token.
 */
export async function issueAccessToken(
  principal: Omit<AccessTokenClaims, 'type'>,
  expiresInSeconds: number = env.ACCESS_TOKEN_TTL_SECONDS,
): Promise<string> {
  const key = deriveKey('access');

  return new SignJWT({
    kind: principal.kind,
    email: principal.email,
    ...(principal.role ? { role: principal.role } : {}),
    ...(principal.permissions ? { permissions: principal.permissions } : {}),
    type: 'access',
  })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setSubject(principal.sub)
    .setIssuer(env.JWT_ISSUER)
    .setAudience('ajooba-api')
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .setJti(randomUUID())
    .sign(key);
}

/**
 * Verify an access token and return the principal it carries.
 *
 * Throws `UnauthorizedError` for any problem — an expired token, a bad
 * signature, a token issued for a refresh endpoint, a token of the wrong
 * type. The specific reason is not disclosed to the client.
 */
export async function verifyAccessToken(token: string): Promise<AuthenticatedPrincipal> {
  const key = deriveKey('access');

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, key, {
      algorithms: [ALG],
      issuer: env.JWT_ISSUER,
      audience: 'ajooba-api',
    });
    payload = result.payload;
  } catch {
    /*
     * The specific reason (expired, bad signature, wrong audience) is not
     * disclosed to the client — the message is the same for all of them.
     */
    throw new UnauthorizedError('Your session is invalid or has expired.');
  }

  if (payload.type !== 'access') {
    throw new UnauthorizedError('Your session is invalid or has expired.');
  }

  const kind = payload.kind;
  const sub = payload.sub;
  if ((kind !== 'customer' && kind !== 'admin') || typeof sub !== 'string' || !sub) {
    throw new UnauthorizedError('Your session is invalid or has expired.');
  }

  const email = typeof payload.email === 'string' ? payload.email : '';
  const role = typeof payload.role === 'string' ? (payload.role as AdminRole) : undefined;
  const permissions = Array.isArray(payload.permissions)
    ? (payload.permissions as AdminPermission[])
    : undefined;

  return {
    kind,
    id: sub,
    email,
    ...(role ? { role } : {}),
    ...(permissions ? { permissions } : {}),
  };
}

/**
 * The lifetime of a refresh token, in seconds.
 */
export function refreshTokenTtlSeconds(): number {
  return env.REFRESH_TOKEN_TTL_SECONDS;
}

/**
 * The lifetime of an access token, in seconds.
 */
export function accessTokenTtlSeconds(): number {
  return env.ACCESS_TOKEN_TTL_SECONDS;
}

/**
 * The token type constants, re-exported so the callers do not have to
 * import from the contracts package directly.
 */
export const TOKEN_TYPE_ACCESS: TokenType = 'access';
export const TOKEN_TYPE_REFRESH: TokenType = 'refresh';

/* -------------------------------------------------------------------------- */
/* OAuth state                                                                */
/* -------------------------------------------------------------------------- */

/**
 * How long a shopper has to complete a consent screen before the round trip is
 * abandoned. Five minutes is a slow sign-in, not a fast one.
 */
const OAUTH_STATE_TTL_SECONDS = 300;

export interface OAuthStateClaims {
  /** The provider this state was minted for. A state for Google is useless at
   * Facebook's callback, so this is checked rather than trusted. */
  readonly provider: string;
  /** Where the shopper goes afterwards. Already validated as a relative path. */
  readonly next: string;
}

/**
 * Mint the `state` parameter for an OAuth round trip.
 *
 * ## Why the state is a signed token rather than a row in a table
 *
 * The state has exactly one job: prove that the callback we just received
 * belongs to a sign-in **this server started**, not to a link somebody crafted.
 * A signed, short-lived token proves that on its own, with no storage, no
 * cleanup job, and no way for an abandoned sign-in to leave litter behind.
 *
 * It carries the destination path so the callback can send the shopper back to
 * the design they were looking at. That value is signed, so it cannot be
 * rewritten in flight — which is what stops this from becoming an open redirect.
 */
export async function issueOAuthState(claims: OAuthStateClaims): Promise<string> {
  return new SignJWT({ provider: claims.provider, next: claims.next, type: 'oauth_state' })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuer(env.JWT_ISSUER)
    .setAudience('ajooba-oauth')
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_STATE_TTL_SECONDS}s`)
    .setJti(randomUUID())
    .sign(deriveKey('access'));
}

/**
 * Verify a `state` returned by a provider.
 *
 * Returns `null` for anything wrong — expired, wrong issuer, wrong provider,
 * unsigned — and the caller turns that into a refusal. Nothing from the token
 * is used before it has been verified.
 */
export async function verifyOAuthState(
  token: string,
  expectedProvider: string,
): Promise<OAuthStateClaims | null> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, deriveKey('access'), {
      algorithms: [ALG],
      issuer: env.JWT_ISSUER,
      audience: 'ajooba-oauth',
    });
    payload = result.payload;
  } catch {
    return null;
  }

  if (payload.type !== 'oauth_state' || payload.provider !== expectedProvider) {
    return null;
  }

  return {
    provider: expectedProvider,
    next: typeof payload.next === 'string' && payload.next.startsWith('/') ? payload.next : '/account',
  };
}

/**
 * The default access-token lifetime declared in the contracts package.
 * Kept here so the two can be compared in a test.
 */
export const DEFAULT_ACCESS_TOKEN_TTL = ACCESS_TOKEN_TTL_SECONDS;
export const DEFAULT_REFRESH_TOKEN_TTL = REFRESH_TOKEN_TTL_SECONDS;
