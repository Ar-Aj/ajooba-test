import { describe, expect, it } from 'vitest';
import { isSafePath, resolveProxiedPath } from '@/lib/proxy-path';

/**
 * Admin proxy path validation.
 *
 * The admin panel's proxy routes forward a browser-supplied path segment to
 * the API. If that segment is not validated, the panel becomes an open proxy
 * into the rest of the administrator API — and the escape is *silent*: the
 * `new URL()` normalisation inside the API client resolves `..` segments
 * before the request is made, so the request that leaves the panel looks
 * legitimate.
 *
 * These tests assert the observable consequence: a path that would escape the
 * intended prefix is refused, and a legitimate path still resolves.
 */

const PREFIX = '/v1/admin/content';

describe('isSafePath', () => {
  it('accepts an ordinary sub-path', () => {
    expect(isSafePath('/homepage/sections')).toBe(true);
    expect(isSafePath('homepage/sections')).toBe(true);
    expect(isSafePath('/blocks')).toBe(true);
  });

  it('rejects an empty path', () => {
    expect(isSafePath('')).toBe(false);
  });

  it('rejects a path with a relative segment', () => {
    expect(isSafePath('/x/../../v1/admin/users')).toBe(false);
    expect(isSafePath('../admin/users')).toBe(false);
    expect(isSafePath('/homepage/../../admin/audit-logs')).toBe(false);
  });

  it('rejects percent-encoded traversal', () => {
    expect(isSafePath('/x/%2e%2e/%2e%2e/v1/admin/users')).toBe(false);
    expect(isSafePath('%2e%2e/v1/admin/users')).toBe(false);
  });

  it('rejects a null byte', () => {
    expect(isSafePath('/homepage\0/sections')).toBe(false);
  });

  it('rejects an over-long path', () => {
    expect(isSafePath(`/${'a'.repeat(400)}`)).toBe(false);
  });

  it('rejects a path whose segment contains an unexpected character', () => {
    expect(isSafePath('/home page')).toBe(false);
    expect(isSafePath('/homepage?a=b')).toBe(false);
    expect(isSafePath('/homepage#frag')).toBe(false);
  });
});

describe('resolveProxiedPath', () => {
  it('resolves a legitimate path inside the prefix', () => {
    const resolved = resolveProxiedPath(PREFIX, '/homepage/sections');
    expect(resolved).not.toBeNull();
    expect(resolved?.pathname).toBe('/v1/admin/content/homepage/sections');
  });

  it('refuses a path that escapes the prefix', () => {
    // The exact shape that would have escaped before the fix.
    expect(resolveProxiedPath(PREFIX, '/x/../../../../v1/admin/users')).toBeNull();
    expect(resolveProxiedPath(PREFIX, '/../../../../v1/admin/audit-logs')).toBeNull();
    expect(resolveProxiedPath(PREFIX, '../../../../v1/admin/orders')).toBeNull();
  });

  it('refuses a path that resolves to a sibling prefix', () => {
    expect(resolveProxiedPath(PREFIX, '/../catalog/products')).toBeNull();
  });

  it('refuses a path that resolves to the API root', () => {
    expect(resolveProxiedPath(PREFIX, '/../../../../v1')).toBeNull();
  });

  it('never resolves to a different origin', () => {
    const resolved = resolveProxiedPath(PREFIX, '/homepage/sections');
    expect(resolved?.origin).toBe('http://internal.invalid');
  });
});
