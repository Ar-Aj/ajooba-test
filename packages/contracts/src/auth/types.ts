/**
 * Authentication and authorisation contracts.
 *
 * Two *separate* identity domains exist in this platform and they are
 * deliberately NOT merged:
 *
 *  - **Customers** authenticate against the `users` collection with an
 *    email + password. They can only ever act on their own records.
 *  - **Administrators** authenticate against the `admin_users` collection and
 *    must additionally carry a role that grants the specific permission the
 *    requested endpoint requires.
 *
 * Keeping them apart means a customer account can never be escalated into an
 * administrator account by a customer-facing endpoint, and the two surfaces
 * can have entirely different session lifetimes and lockout policies.
 */

/**
 * Roles an administrator can hold.
 *
 * `owner` is the bootstrap role created by the first-admin command. It is
 * the only role that may manage other administrators.
 */
export const ADMIN_ROLES = ['owner', 'admin', 'manager', 'support', 'content-editor'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/**
 * Fine-grained permissions.
 *
 * Every administrator endpoint declares the permission it requires, and the
 * server checks it against the role's grant list. The check is server-side
 * only — the admin UI is never the authority.
 */
export const ADMIN_PERMISSIONS = [
  'catalog:read',
  'catalog:write',
  'inventory:write',
  'orders:read',
  'orders:write',
  'returns:read',
  'returns:write',
  'coupons:read',
  'coupons:write',
  'customers:read',
  'content:read',
  'content:write',
  'settings:read',
  'settings:write',
  'analytics:read',
  'admin:read',
  'admin:write',
  'audit:read',
  'import:run',
  /**
   * Read shipment state, AWBs and tracking.
   *
   * Separate from `orders:read` because a shipment is a different thing
   * from an order: the fulfilment team needs to see the AWB and the courier
   * without being able to change the order it belongs to.
   */
  'shipping:read',
  /**
   * Create shipments, assign AWBs, request pickups and cancel dispatch.
   *
   * Held by `owner`, `admin` and `manager` only. `support` can read a
   * shipment and answer "where is my parcel?" but cannot dispatch one —
   * creating a shipment is a fulfilment action with a real-world cost.
   */
  'shipping:write',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/**
 * The permission grants for each role.
 *
 * Least privilege is applied literally: `support` can read and act on
 * orders and returns but cannot touch the catalogue, coupons, settings or
 * other administrators.
 */
export const ADMIN_ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> =
  Object.freeze({
    owner: ADMIN_PERMISSIONS,
    admin: [
      'catalog:read',
      'catalog:write',
      'inventory:write',
      'orders:read',
      'orders:write',
      'returns:read',
      'returns:write',
      'coupons:read',
      'coupons:write',
      'customers:read',
      'content:read',
      'content:write',
      'settings:read',
      'analytics:read',
      'admin:read',
      'audit:read',
      'import:run',
      'shipping:read',
      'shipping:write',
    ],
    manager: [
      'catalog:read',
      'catalog:write',
      'inventory:write',
      'orders:read',
      'orders:write',
      'returns:read',
      'returns:write',
      'coupons:read',
      'content:read',
      'analytics:read',
      'shipping:read',
      'shipping:write',
    ],
    support: [
      'orders:read',
      'orders:write',
      'returns:read',
      'returns:write',
      'customers:read',
      'shipping:read',
    ],
    'content-editor': ['catalog:read', 'content:read', 'content:write'],
  });

/**
 * Does a role hold a permission?
 */
export function roleHasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ADMIN_ROLE_PERMISSIONS[role].includes(permission);
}

/** The subject type carried in an access token. */
export const TOKEN_TYPES = ['access', 'refresh'] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

/** Token lifetimes, in seconds. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * The public projection of a customer account.
 *
 * It deliberately contains no password material and no internal flags.
 */
export interface CustomerProfile {
  readonly id: string;
  readonly email: string;
  readonly phone: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly addresses: readonly CustomerAddress[];
  readonly wishlist: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A saved delivery address. */
export interface CustomerAddress {
  readonly id: string;
  readonly label: string;
  readonly fullName: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly country: string;
  readonly isDefault: boolean;
}

/** The public projection of an administrator. */
export interface AdminProfile {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: AdminRole;
  readonly permissions: readonly AdminPermission[];
  readonly isActive: boolean;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

/**
 * The token pair returned by register / login / refresh.
 */
export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: 'Bearer';
  /** Access token lifetime in seconds. */
  readonly expiresIn: number;
}

/** The result of a successful register / login. */
export interface AuthSession {
  readonly user: CustomerProfile;
  readonly tokens: AuthTokens;
}

/** The result of a successful administrator login. */
export interface AdminSession {
  readonly admin: AdminProfile;
  readonly tokens: AuthTokens;
}

/**
 * The identity attached to a request after authentication.
 */
export interface AuthenticatedPrincipal {
  readonly kind: 'customer' | 'admin';
  readonly id: string;
  readonly email: string;
  /** Present only for administrators. */
  readonly role?: AdminRole;
  /** Present only for administrators. */
  readonly permissions?: readonly AdminPermission[];
}
