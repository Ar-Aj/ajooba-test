import { Router } from 'express';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  nextPathSchema,
  passwordResetRequestSchema,
  refreshTokenRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  updateProfileRequestSchema,
  verifyResetTokenRequestSchema,
  type AdminSession,
  type AuthSession,
  type ChangePasswordRequest,
  type CustomerProfile,
  type LoginRequest,
  type OAuthProvider,
  type PasswordResetRequest,
  type RefreshTokenRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
  type UpdateProfileRequest,
  type VerifyResetTokenRequest,
} from '@ajooba/contracts';
import { env } from '../config/env.js';
import { NotFoundError, UnauthorizedError } from '../core/errors.js';
import { sendSuccess } from '../core/http.js';
import { getRequestId } from '../middleware/error-handler.js';
import { requireAdmin, requireCustomer } from '../middleware/auth.js';
import {
  authLimiter,
  passwordLimiter,
  refreshLimiter,
  registerLimiter,
} from '../middleware/rate-limit.js';
import { validateBody, validatedBody } from '../middleware/validate.js';
import { UserModel } from '../models/user.model.js';
import {
  changeAdminPassword,
  changeCustomerPassword,
  getAdminById,
  getCustomerById,
  loginAdmin,
  loginCustomer,
  refreshSession,
  registerCustomer,
  revokeAllRefreshTokens,
  revokeRefreshToken,
} from '../services/auth.service.js';
import { writeAuditLog } from '../services/audit.service.js';
import {
  availableProviders,
  completeOAuthSignIn,
  getAdapter,
  ProviderNotConfiguredError,
  redirectUriFor,
} from '../services/oauth.service.js';
import { issueOAuthState, verifyOAuthState } from '../services/token.service.js';
import {
  assertResetPasswordStrength,
  requestPasswordReset,
  resetPasswordWithGrant,
  verifyResetToken,
} from '../services/password-reset.service.js';

/**
 * Authentication routes.
 *
 * Two separate surfaces:
 *
 *  - `/v1/auth/*` — customer accounts, against the `users` collection.
 *  - `/v1/admin/auth/*` — administrator accounts, against the
 *    `admin_users` collection.
 *
 * A token minted for one never authenticates the other. There is no
 * "login as admin" on the customer surface, and no customer route accepts
 * an administrator token.
 */

export const authRouter: Router = Router();

/**
 * The client context recorded against a session — a coarse user agent and
 * the client IP. Both are stored with the refresh token for the audit
 * trail and are never exposed to the client.
 */
function clientContext(req: Parameters<typeof getRequestId>[0]): {
  userAgent: string;
  ip: string;
} {
  return {
    userAgent: req.header('user-agent') ?? '',
    ip: req.ip ?? '',
  };
}

/* -------------------------------------------------------------------------- */
/* Social sign-in                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Which social buttons the storefront should render.
 *
 * Public and unauthenticated: the sign-in page needs it before anybody has a
 * session, and it exposes nothing but the names of the doors that are open. A
 * provider with no credentials is simply absent, so the storefront never draws a
 * button that cannot work.
 */
authRouter.get('/providers', (req, res) => {
  sendSuccess(res, { providers: availableProviders() }, getRequestId(req));
});

/**
 * Begin a social sign-in.
 *
 * Answers with a redirect to the provider's consent screen. The `state` is a
 * signed token carrying the provider and a validated relative return path, so
 * the callback can trust both without any server-side storage.
 */
authRouter.get('/oauth/:provider/start', authLimiter, async (req, res, next) => {
  try {
    const provider = String(req.params.provider ?? '');
    const adapter = getAdapter(provider);
    if (!adapter) {
      throw new NotFoundError('Sign-in provider');
    }
    if (!adapter.configured()) {
      throw new ProviderNotConfiguredError(provider as OAuthProvider);
    }

    /*
     * `next` is re-validated here rather than trusted from the query string. A
     * value that is not a relative path is dropped, not rejected: a shopper who
     * followed a malformed link should still be able to sign in.
     */
    const nextParsed = nextPathSchema.safeParse(req.query.next);
    const next = nextParsed.success ? nextParsed.data : '/account';

    const state = await issueOAuthState({ provider, next });
    const redirectUri = redirectUriFor(provider as OAuthProvider, env.API_PUBLIC_URL);

    res.redirect(302, adapter.authorizeUrl(state, redirectUri));
  } catch (error) {
    next(error);
  }
});

/**
 * The provider's return leg.
 *
 * On success the shopper is sent to the storefront with the token pair in the
 * URL fragment. On failure they are sent back to the sign-in page with a
 * `?error=` code the page turns into a sentence — a provider's raw error is
 * never shown, because it is written for a developer.
 */
authRouter.get('/oauth/:provider/callback', authLimiter, async (req, res, _next) => {
  const provider = String(req.params.provider ?? '');
  const storefront = env.STOREFRONT_PUBLIC_URL.replace(/\/+$/, '');

  try {
    const adapter = getAdapter(provider);
    if (!adapter) {
      throw new NotFoundError('Sign-in provider');
    }

    /*
     * A shopper who pressed "Cancel" on the consent screen arrives here with
     * `error=access_denied` and no code. That is a decision, not a fault, and it
     * deserves to be treated as one.
     */
    if (typeof req.query.error === 'string') {
      res.redirect(302, `${storefront}/login?error=oauth_cancelled`);
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';

    if (!code || !state) {
      res.redirect(302, `${storefront}/login?error=oauth_incomplete`);
      return;
    }

    const verifiedState = await verifyOAuthState(state, provider);
    if (!verifiedState) {
      /*
       * The state is signed and short-lived, so a failure here means the link was
       * crafted, replayed, or left open for longer than five minutes. The shopper
       * is sent back to start again with a message that says so plainly.
       */
      res.redirect(302, `${storefront}/login?error=oauth_expired`);
      return;
    }

    const completion = await completeOAuthSignIn({
      provider: provider as OAuthProvider,
      code,
      apiPublicUrl: env.API_PUBLIC_URL,
      context: clientContext(req),
      next: verifiedState.next,
    });

    /*
     * The session travels in the fragment, not the query string: a fragment is
     * never sent to a server, never appears in a `Referer`, and never lands in
     * an access log. The receiving page reads it, stores it, and replaces the
     * URL before first paint.
     */
    const params = new URLSearchParams({
      accessToken: completion.session.tokens.accessToken,
      refreshToken: completion.session.tokens.refreshToken,
      expiresIn: String(completion.session.tokens.expiresIn),
      next: completion.next,
      created: completion.created ? '1' : '0',
    });

    res.redirect(302, `${storefront}/auth/callback#${params.toString()}`);
  } catch (error) {
    /*
     * Every failure still ends at the storefront. A dead-end API error page in
     * the middle of a sign-in is the worst possible outcome: the shopper has
     * already left, and there is nothing on screen to go back to.
     */
    req.log.warn({ err: error, provider }, 'Social sign-in failed');
    res.redirect(302, `${storefront}/login?error=oauth_failed`);
  }
});

/* -------------------------------------------------------------------------- */
/* Customer                                                                   */
/* -------------------------------------------------------------------------- */

authRouter.post(
  '/register',
  registerLimiter,
  validateBody(registerRequestSchema),
  async (req, res, next) => {
    try {
      const session: AuthSession = await registerCustomer(
        validatedBody<RegisterRequest>(req),
        clientContext(req),
      );
      sendSuccess(res, session, getRequestId(req), 201);
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post('/login', authLimiter, validateBody(loginRequestSchema), async (req, res, next) => {
  try {
    const session: AuthSession = await loginCustomer(
      validatedBody<LoginRequest>(req),
      clientContext(req),
    );
    sendSuccess(res, session, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

authRouter.post(
  '/refresh',
  refreshLimiter,
  validateBody(refreshTokenRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<RefreshTokenRequest>(req);
      const result = await refreshSession(body.refreshToken, clientContext(req));
      sendSuccess(res, result.tokens, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Sign out of one device.
 *
 * The refresh token is optional — signing out is idempotent and a client
 * that has already lost its token should still be able to call this. It is
 * *validated* when present, so a malformed token is a 422 rather than a
 * silently-ignored body.
 */
const optionalRefreshTokenSchema = refreshTokenRequestSchema.partial();

authRouter.post('/logout', validateBody(optionalRefreshTokenSchema), async (req, res, next) => {
  try {
    const body = validatedBody<{ refreshToken?: string }>(req);
    if (body.refreshToken) {
      await revokeRefreshToken(body.refreshToken);
    }
    sendSuccess(res, { revoked: true }, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/**
 * The signed-in customer.
 */
authRouter.get('/me', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedError('Authentication required.');
    }
    const profile = await getCustomerById(principal.id);
    if (!profile) {
      throw new UnauthorizedError('Your session is invalid or has expired.');
    }
    sendSuccess(res, profile, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/**
 * Update the signed-in customer's own profile.
 */
authRouter.patch(
  '/me',
  requireCustomer,
  validateBody(updateProfileRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) {
        throw new UnauthorizedError('Authentication required.');
      }
      const profile = await getCustomerById(principal.id);
      if (!profile) {
        throw new UnauthorizedError('Your session is invalid or has expired.');
      }

      const body = validatedBody<UpdateProfileRequest>(req);
      const update: Record<string, unknown> = {};
      if (body.firstName !== undefined) update.firstName = body.firstName;
      if (body.lastName !== undefined) update.lastName = body.lastName;
      if (body.phone !== undefined) update.phone = body.phone;

      if (Object.keys(update).length > 0) {
        await UserModel.updateOne({ _id: principal.id }, { $set: update });
      }

      const updated = await getCustomerById(principal.id);
      sendSuccess(res, updated satisfies CustomerProfile | null, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Change the signed-in customer's own password.
 *
 * Changing the password revokes every refresh token, so every other
 * device is signed out.
 */
authRouter.post(
  '/change-password',
  requireCustomer,
  passwordLimiter,
  validateBody(changePasswordRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) {
        throw new UnauthorizedError('Authentication required.');
      }

      const body = validatedBody<ChangePasswordRequest>(req);

      await changeCustomerPassword(principal.id, body.currentPassword, body.newPassword);
      sendSuccess(res, { changed: true }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Begin a password recovery.
 *
 * The response is **identical** whether or not the address is registered.
 * A different answer for a known address would turn this endpoint into a
 * free account-enumeration oracle, so the only thing the caller learns is
 * "we have accepted your request".
 *
 * The recovery link is emailed by the transactional outbox, not sent inline
 * here: the endpoint must not block on a third-party mail provider, and a
 * slow provider must not make recovery look broken.
 */
authRouter.post(
  '/password-reset/request',
  passwordLimiter,
  validateBody(passwordResetRequestSchema),
  async (req, res, next) => {
    try {
      await requestPasswordReset({
        email: validatedBody<PasswordResetRequest>(req).email,
        ...clientContext(req),
      });
      sendSuccess(res, { accepted: true }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Exchange a reset token for a short-lived reset grant.
 *
 * The token is single-use: redeeming it stamps it, so a link that leaks
 * into a shared inbox cannot be used a second time.
 */
authRouter.post(
  '/password-reset/verify',
  passwordLimiter,
  validateBody(verifyResetTokenRequestSchema),
  async (req, res, next) => {
    try {
      const grant = await verifyResetToken(validatedBody<VerifyResetTokenRequest>(req).token);
      sendSuccess(res, { grantToken: grant.grantToken }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Complete a password reset.
 *
 * The grant is proved against the stored reset-token hash, so a client
 * cannot invent one. Changing the password ends every existing session.
 */
authRouter.post(
  '/password-reset/complete',
  passwordLimiter,
  validateBody(resetPasswordRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<ResetPasswordRequest>(req);
      assertResetPasswordStrength(body.newPassword);

      /*
       * The grant is proved against the stored hash, so a client cannot
       * invent one, and it is spent exactly once.
       */
      await resetPasswordWithGrant({
        grantToken: body.grantToken,
        newPassword: body.newPassword,
      });

      sendSuccess(res, { changed: true }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Sign out of every device.
 */
authRouter.post('/logout-all', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedError('Authentication required.');
    }
    await revokeAllRefreshTokens('customer', principal.id);
    sendSuccess(res, { revoked: true }, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Administrator                                                              */
/* -------------------------------------------------------------------------- */

export const adminAuthRouter: Router = Router();

adminAuthRouter.post(
  '/login',
  authLimiter,
  validateBody(loginRequestSchema),
  async (req, res, next) => {
    try {
      const session: AdminSession = await loginAdmin(
        validatedBody<LoginRequest>(req),
        clientContext(req),
      );
      await writeAuditLog({
        actorId: session.admin.id,
        actorEmail: session.admin.email,
        actorRole: session.admin.role,
        action: 'login',
        entity: 'admin_user',
        entityId: session.admin.id,
        summary: `${session.admin.email} signed in`,
        ip: req.ip ?? null,
      });
      sendSuccess(res, session, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

adminAuthRouter.post(
  '/refresh',
  refreshLimiter,
  validateBody(refreshTokenRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<RefreshTokenRequest>(req);
      const result = await refreshSession(body.refreshToken, clientContext(req));
      if (result.kind !== 'admin') {
        throw new UnauthorizedError('Your session is invalid or has expired.');
      }
      sendSuccess(res, result.tokens, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

adminAuthRouter.post(
  '/logout',
  validateBody(optionalRefreshTokenSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<{ refreshToken?: string }>(req);
      if (body.refreshToken) {
        await revokeRefreshToken(body.refreshToken);
      }
      sendSuccess(res, { revoked: true }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The signed-in administrator.
 */
adminAuthRouter.get('/me', requireAdmin, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedError('Authentication required.');
    }
    const profile = await getAdminById(principal.id);
    if (!profile) {
      throw new UnauthorizedError('Your session is invalid or has expired.');
    }
    sendSuccess(res, profile, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/**
 * Change the signed-in administrator's own password.
 */
adminAuthRouter.post(
  '/change-password',
  requireAdmin,
  passwordLimiter,
  validateBody(changePasswordRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) {
        throw new UnauthorizedError('Authentication required.');
      }

      const body = validatedBody<ChangePasswordRequest>(req);

      await changeAdminPassword(principal.id, body.currentPassword, body.newPassword);
      sendSuccess(res, { changed: true }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);
