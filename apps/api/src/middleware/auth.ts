import type { Request, RequestHandler } from 'express';
import {
  ADMIN_ROLE_PERMISSIONS,
  roleHasPermission,
  type AdminPermission,
  type AdminRole,
  type AuthenticatedPrincipal,
} from '@ajooba/contracts';
import { ForbiddenError, UnauthorizedError } from '../core/errors.js';
import { loadAdminPrincipal } from '../services/auth.service.js';
import { verifyAccessToken } from '../services/token.service.js';

/**
 * Authentication and authorisation middleware.
 *
 * The rules this file enforces:
 *
 *  1. A route declares its required identity kind and permissions
 *     explicitly. There is no implicit "logged in means allowed".
 *  2. A customer token can never satisfy an administrator route, and an
 *     administrator token can never satisfy a customer route. The two
 *     identity domains are disjoint.
 *  3. The administrator's role is re-read from the database on every
 *     request, so deactivating an administrator takes effect immediately
 *     rather than when their access token expires.
 */

/**
 * The principal attached to an authenticated request.
 */
export interface AuthenticatedRequest extends Request {
  principal?: AuthenticatedPrincipal;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth` / `requireCustomer` / `requireAdmin`. */
      principal?: AuthenticatedPrincipal;
    }
  }
}

/**
 * Extract the bearer token from the `Authorization` header.
 */
function readBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) {
    return null;
  }
  const [scheme, ...rest] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

/**
 * Require a valid access token of any kind.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = readBearerToken(req);
  if (!token) {
    next(new UnauthorizedError('Authentication required.'));
    return;
  }

  verifyAccessToken(token)
    .then((principal) => {
      req.principal = principal;
      next();
    })
    .catch(next);
};

/**
 * Attach the principal **if** a valid token is present, without requiring
 * one.
 *
 * Used by the endpoints that are meaningful both signed-in and signed-out
 * but behave differently for each — the public coupon preview, for
 * example, discloses a discount value only to a caller whose own cart the
 * server can see.
 *
 * An invalid or expired token is treated as "not signed in" rather than an
 * error, because the endpoint works either way. A token that cannot be
 * verified is not evidence of anything.
 */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = readBearerToken(req);
  if (!token) {
    next();
    return;
  }

  verifyAccessToken(token)
    .then((principal) => {
      req.principal = principal;
      next();
    })
    .catch(() => {
      next();
    });
};

/**
 * Require a valid **customer** access token.
 *
 * An administrator token is rejected. The two identity domains never
 * cross.
 */
export const requireCustomer: RequestHandler = (req, _res, next) => {
  const token = readBearerToken(req);
  if (!token) {
    next(new UnauthorizedError('Authentication required.'));
    return;
  }

  verifyAccessToken(token)
    .then((principal) => {
      if (principal.kind !== 'customer') {
        throw new ForbiddenError('This endpoint is for customer accounts only.');
      }
      req.principal = principal;
      next();
    })
    .catch(next);
};

/**
 * Require a valid **administrator** access token.
 *
 * The live administrator record is loaded so that a deactivated account is
 * rejected immediately.
 */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  const token = readBearerToken(req);
  if (!token) {
    next(new UnauthorizedError('Authentication required.'));
    return;
  }

  void (async () => {
    try {
      const principal = await verifyAccessToken(token);
      if (principal.kind !== 'admin') {
        throw new ForbiddenError('This endpoint is for administrator accounts only.');
      }

      const live = await loadAdminPrincipal(principal.id);
      if (!live) {
        throw new UnauthorizedError('Your session is invalid or has expired.');
      }

      req.principal = {
        kind: 'admin',
        id: live.id,
        email: live.email,
        role: live.role,
        permissions: live.permissions,
      };
      next();
    } catch (error) {
      next(error);
    }
  })();
};

/**
 * Require a specific administrator permission.
 *
 * The permission is checked against the role's grant list, server-side.
 * The admin UI's visibility rules are a convenience, never the authority.
 */
export function requirePermission(permission: AdminPermission): RequestHandler {
  return (req, _res, next) => {
    const principal = req.principal;
    if (!principal) {
      next(new UnauthorizedError('Authentication required.'));
      return;
    }
    if (principal.kind !== 'admin' || !principal.role) {
      next(new ForbiddenError('This endpoint is for administrator accounts only.'));
      return;
    }
    if (!roleHasPermission(principal.role, permission)) {
      next(
        new ForbiddenError(
          `Your role (${principal.role}) does not have the "${permission}" permission.`,
        ),
      );
      return;
    }
    next();
  };
}

/**
 * Require any one of several permissions.
 */
export function requireAnyPermission(...permissions: AdminPermission[]): RequestHandler {
  return (req, _res, next) => {
    const principal = req.principal;
    if (!principal) {
      next(new UnauthorizedError('Authentication required.'));
      return;
    }
    if (principal.kind !== 'admin' || !principal.role) {
      next(new ForbiddenError('This endpoint is for administrator accounts only.'));
      return;
    }
    const granted = permissions.some((permission) =>
      roleHasPermission(principal.role as AdminRole, permission),
    );
    if (!granted) {
      next(
        new ForbiddenError(
          `Your role (${principal.role}) does not have any of: ${permissions.join(', ')}.`,
        ),
      );
      return;
    }
    next();
  };
}

/**
 * Read the principal from a request that has already been authenticated.
 *
 * Throws if the route was mounted without the authentication middleware —
 * that is a programming error, not a client error, so it is surfaced
 * loudly rather than being turned into a 403.
 */
export function requirePrincipal(req: Request): AuthenticatedPrincipal {
  const principal = req.principal;
  if (!principal) {
    throw new Error('requirePrincipal() called on an unauthenticated request.');
  }
  return principal;
}

/**
 * The permissions granted to a role. Exposed so the admin panel can
 * render an accurate view of what each role can do.
 */
export function permissionsForRole(role: AdminRole): readonly AdminPermission[] {
  return ADMIN_ROLE_PERMISSIONS[role];
}
