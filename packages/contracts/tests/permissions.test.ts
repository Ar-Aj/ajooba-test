import { describe, expect, it } from 'vitest';
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLE_PERMISSIONS,
  ADMIN_ROLES,
  roleHasPermission,
  type AdminPermission,
} from '@ajooba/contracts';

/**
 * Administrator role and permission matrix.
 *
 * The permission check is server-side, and the admin UI's visibility rules
 * are only a convenience. This matrix is therefore the actual security
 * boundary, so it is asserted here as a pure function: a refactor that
 * quietly widens a role's grants fails loudly rather than silently.
 *
 * The properties asserted below encode the platform's stated least-privilege
 * policy:
 *
 *  - `owner` holds everything, and only `owner` may manage other
 *    administrators or the store settings;
 *  - `admin` runs the store but still cannot manage administrators;
 *  - `manager` runs the catalogue and orders but not coupons of the
 *    destructive kind, nor settings;
 *  - `support` acts on orders and returns only;
 *  - `content-editor` edits content only.
 */

/** Permissions that only the owner may ever hold. */
const OWNER_ONLY_PERMISSIONS: readonly AdminPermission[] = ['settings:write', 'admin:write'];

/** Permissions that the `support` role must never hold. */
const SUPPORT_FORBIDDEN: readonly AdminPermission[] = [
  'catalog:read',
  'catalog:write',
  'inventory:write',
  'coupons:read',
  'coupons:write',
  'content:read',
  'content:write',
  'settings:read',
  'settings:write',
  'admin:read',
  'admin:write',
  'audit:read',
  'import:run',
];

/** Permissions that the `content-editor` role must never hold. */
const CONTENT_EDITOR_FORBIDDEN: readonly AdminPermission[] = [
  'catalog:write',
  'inventory:write',
  'orders:read',
  'orders:write',
  'returns:read',
  'returns:write',
  'coupons:read',
  'coupons:write',
  'customers:read',
  'settings:read',
  'settings:write',
  'admin:read',
  'admin:write',
  'audit:read',
  'import:run',
];

describe('ADMIN_ROLE_PERMISSIONS', () => {
  it('defines a grant list for every declared role', () => {
    for (const role of ADMIN_ROLES) {
      expect(Array.isArray(ADMIN_ROLE_PERMISSIONS[role])).toBe(true);
      expect(ADMIN_ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it('gives the owner every permission', () => {
    const owner = ADMIN_ROLE_PERMISSIONS.owner;
    for (const permission of ADMIN_PERMISSIONS) {
      expect(owner).toContain(permission);
    }
  });

  it('keeps settings and administrator management to the owner alone', () => {
    for (const role of ADMIN_ROLES) {
      if (role === 'owner') {
        continue;
      }
      for (const permission of OWNER_ONLY_PERMISSIONS) {
        expect(ADMIN_ROLE_PERMISSIONS[role]).not.toContain(permission);
      }
    }
  });

  it('confines the support role to orders, returns and customers', () => {
    const support = ADMIN_ROLE_PERMISSIONS.support;
    for (const permission of SUPPORT_FORBIDDEN) {
      expect(support).not.toContain(permission);
    }
    expect(support).toContain('orders:read');
    expect(support).toContain('orders:write');
    expect(support).toContain('returns:read');
    expect(support).toContain('returns:write');
    expect(support).toContain('customers:read');
  });

  it('confines the content-editor role to reading the catalogue and editing content', () => {
    const editor = ADMIN_ROLE_PERMISSIONS['content-editor'];
    for (const permission of CONTENT_EDITOR_FORBIDDEN) {
      expect(editor).not.toContain(permission);
    }
    expect(editor).toContain('catalog:read');
    expect(editor).toContain('content:read');
    expect(editor).toContain('content:write');
  });

  it('never lets a lower role hold a permission the owner lacks', () => {
    const owner = new Set<AdminPermission>(ADMIN_ROLE_PERMISSIONS.owner);
    for (const role of ADMIN_ROLES) {
      for (const permission of ADMIN_ROLE_PERMISSIONS[role]) {
        expect(owner.has(permission)).toBe(true);
      }
    }
  });

  it('never grants an unknown permission string', () => {
    const known = new Set<string>(ADMIN_PERMISSIONS);
    for (const role of ADMIN_ROLES) {
      for (const permission of ADMIN_ROLE_PERMISSIONS[role]) {
        expect(known.has(permission)).toBe(true);
      }
    }
  });
});

describe('roleHasPermission', () => {
  it('grants a permission a role holds', () => {
    expect(roleHasPermission('owner', 'catalog:write')).toBe(true);
    expect(roleHasPermission('support', 'orders:write')).toBe(true);
  });

  it('refuses a permission a role does not hold', () => {
    expect(roleHasPermission('support', 'catalog:write')).toBe(false);
    expect(roleHasPermission('content-editor', 'settings:write')).toBe(false);
  });

  it('agrees with the matrix for every role and permission pair', () => {
    for (const role of ADMIN_ROLES) {
      for (const permission of ADMIN_PERMISSIONS) {
        const expected = ADMIN_ROLE_PERMISSIONS[role].includes(permission);
        expect(roleHasPermission(role, permission)).toBe(expected);
      }
    }
  });
});
