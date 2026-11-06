'use client';

import Link from 'next/link';
import { adminPath } from '@/lib/public-path';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  Boxes,
  ExternalLink,
  FileSpreadsheet,
  Gauge,
  Image as ImageIcon,
  LayoutTemplate,
  LogOut,
  Menu,
  Package,
  PackageSearch,
  Percent,
  ScrollText,
  ShoppingBag,
  Tags,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/format';

/**
 * The panel shell.
 *
 * ## Two layouts, one navigation list
 *
 * On a laptop the navigation is a permanent navy rail. On a phone it is a
 * full-height sheet behind one button in a sticky top bar. Both read from the
 * same `NAV` array, so a screen added to one is added to the other — the failure
 * this avoids is the classic one, where the mobile menu silently loses the newest
 * three screens because it was maintained by hand.
 *
 * ## Why the rail is navy and the active row is rose gold
 *
 * Rose gold is reserved for *what to do and what is being measured*: the primary
 * button, the active row, a chart bar. If the whole rail were rose gold there
 * would be no way to mark the current screen without introducing a second shade,
 * and the panel would have two competing definitions of "active". So the frame is
 * navy — the house's evening colour — and the active row is the one place the
 * rail shows rose gold. Navy appears here and on the sign-in page and almost
 * nowhere else, which is what keeps it feeling like a frame rather than a theme.
 *
 * ## On a phone
 *
 * The top bar is 60px and sticky, the name of the screen is in it, and the button
 * that opens the menu is 44px square — a thumb target, not a 20px icon floating
 * in padding. Rows in the sheet are 48px tall for the same reason. Nothing in
 * this shell requires a designer to explain it.
 */

export interface ShellAdmin {
  readonly email: string;
  readonly name: string;
  readonly role: string;
  readonly permissions: readonly string[];
}

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: typeof Gauge;
  /** Exact match only. Used for the dashboard, whose href is the root. */
  readonly exact?: boolean;
  /** Hidden when the administrator lacks it. Absent means always visible. */
  readonly permission?: string;
  /** A one-line hint, shown in the rail on wide screens. */
  readonly hint?: string;
}

interface NavGroup {
  readonly title: string;
  readonly items: readonly NavItem[];
}

const NAV: readonly NavGroup[] = [
  {
    title: 'Overview',
    items: [{ href: '/', label: 'Dashboard', icon: Gauge, exact: true }],
  },
  {
    title: 'Insights',
    items: [
      {
        href: '/insights',
        label: 'Interactions',
        icon: Activity,
        permission: 'analytics:read',
        hint: 'The whole shop',
      },
      {
        href: '/insights/customers',
        label: 'Customer spectrum',
        icon: Users,
        permission: 'analytics:read',
        hint: 'Who, and what they want',
      },
      {
        href: '/insights/products',
        label: 'Product spectrum',
        icon: PackageSearch,
        permission: 'analytics:read',
        hint: 'Which buttons each design earns',
      },
    ],
  },
  {
    title: 'Sell',
    items: [
      { href: '/orders', label: 'Orders', icon: ShoppingBag, permission: 'orders:read' },
      { href: '/customers', label: 'Customers', icon: Users, permission: 'customers:read' },
      { href: '/promotions', label: 'Promotions', icon: Percent, permission: 'coupons:read' },
    ],
  },
  {
    title: 'Catalogue',
    items: [
      { href: '/catalog/products', label: 'Products', icon: Package, permission: 'catalog:read' },
      { href: '/catalog/categories', label: 'Categories', icon: Tags, permission: 'catalog:read' },
      {
        href: '/catalog/images',
        label: 'Image review',
        icon: ImageIcon,
        permission: 'catalog:read',
      },
      {
        href: '/catalog/imports',
        label: 'Imports',
        icon: FileSpreadsheet,
        permission: 'catalog:write',
      },
    ],
  },
  {
    title: 'Inventory',
    items: [{ href: '/inventory', label: 'Stock', icon: Boxes, permission: 'catalog:read' }],
  },
  {
    title: 'Storefront',
    items: [
      { href: '/homepage', label: 'Homepage', icon: LayoutTemplate, permission: 'content:write' },
      { href: '/audit', label: 'Audit trail', icon: ScrollText, permission: 'audit:read' },
    ],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function visibleGroups(admin: ShellAdmin | null): readonly NavGroup[] {
  if (!admin) return NAV;
  const granted = new Set(admin.permissions);
  /*
   * The owner role carries every permission; treating an empty list as
   * "everything" would be a silent escalation if a token ever arrived without
   * permissions, so an absent list hides the gated rows instead.
   */
  return NAV.map((group) => ({
    title: group.title,
    items: group.items.filter((item) => !item.permission || granted.has(item.permission)),
  })).filter((group) => group.items.length > 0);
}

/**
 * The navigation list itself.
 *
 * Extracted so the rail and the sheet render the identical markup. The active
 * row is a rose-gold block with a brighter hairline on its left edge, which is
 * the only ornament the rail carries.
 */
function NavList({
  groups,
  pathname,
  onNavigate,
  hint = false,
}: {
  groups: readonly NavGroup[];
  pathname: string;
  onNavigate?: () => void;
  /** Show the one-line hint under each label. Rail only; too tight on a phone. */
  hint?: boolean;
}) {
  return (
    <nav
      aria-label="Admin navigation"
      className="scrollbar-soft flex-1 overflow-y-auto px-2.5 pb-5 pt-1"
    >
      {groups.map((group) => (
        <div key={group.title} className="mt-5 first:mt-3">
          <p className="px-3 pb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-white/30">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-[0.9375rem] font-medium transition-colors duration-150',
                      active
                        ? 'bg-rose-500 text-ink-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_0_0_1px_rgba(0,0,0,0.06)]'
                        : 'text-white/62 hover:bg-white/[0.07] hover:text-white',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-[1.125rem] w-[1.125rem] shrink-0',
                        active ? 'text-ink-900' : 'text-white/45',
                      )}
                      strokeWidth={1.75}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {hint && item.hint ? (
                        <span
                          className={cn(
                            'block truncate text-[0.75rem] leading-tight',
                            active ? 'text-ink-800/70' : 'text-white/30',
                          )}
                        >
                          {item.hint}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The wordmark. Serif, because the house's one display voice is serif. */
function Wordmark({ size = 'base' }: { size?: 'base' | 'sm' }) {
  return (
    <span className="flex items-baseline gap-2">
      <span
        className={cn(
          'font-serif tracking-[0.2em] text-white',
          size === 'base' ? 'text-lg' : 'text-base',
        )}
      >
        AJOOBA
      </span>
      <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-rose-300/60">
        Admin
      </span>
    </span>
  );
}

export function AdminShell({
  children,
  storefrontUrl,
  admin,
  apiReachable = true,
}: {
  children: React.ReactNode;
  storefrontUrl: string;
  admin: ShellAdmin | null;
  /** False when the API could not be reached during this render. */
  apiReachable?: boolean;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const groups = visibleGroups(admin);
  const current =
    groups
      .flatMap((group) => group.items)
      .filter((item) => isActive(pathname, item))
      /* The longest match wins: `/insights/customers` is more specific than
         `/insights`, and both match by prefix. */
      .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? 'Dashboard';

  // The sheet must not leave the page scrollable behind it.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const initials = admin
    ? admin.name
        .split(' ')
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'AD';

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr] xl:grid-cols-[18.5rem_1fr]">
      {/* ---- the rail (laptop) ------------------------------------------- */}
      <aside className="hidden bg-navy-950 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="flex h-20 shrink-0 items-center px-5">
          <Link href="/" className="btn-press">
            <Wordmark />
          </Link>
        </div>

        <NavList groups={groups} pathname={pathname} hint />

        <div className="shrink-0 border-t border-white/10 p-2.5">
          {admin ? (
            <div className="mb-2 flex items-center gap-3 rounded-lg px-2.5 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-600/15 text-[0.75rem] font-semibold tracking-[0.04em] text-rose-200 ring-1 ring-inset ring-rose-400/25">
                {initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white/90">
                  {admin.name}
                </span>
                <span className="block truncate text-[0.75rem] text-white/35">{admin.role}</span>
              </span>
            </div>
          ) : null}

          <a
            href={storefrontUrl}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-[0.9375rem] text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            <ExternalLink className="h-[1.0625rem] w-[1.0625rem] shrink-0" strokeWidth={1.75} />
            <span>View storefront</span>
          </a>

          <form action={adminPath('/api/admin/logout')} method="post">
            <button
              type="submit"
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[0.9375rem] text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white"
            >
              <LogOut className="h-[1.0625rem] w-[1.0625rem] shrink-0" strokeWidth={1.75} />
              <span>Sign out</span>
            </button>
          </form>
        </div>
      </aside>

      {/* ---- the column --------------------------------------------------- */}
      <div className="min-w-0">
        {/* The phone and tablet bar. Navy, 60px, the screen's name, two targets. */}
        <div className="sticky top-0 z-30 flex h-15 min-h-14 items-center gap-1.5 bg-navy-950 px-2 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            className="btn-press flex h-11 w-11 items-center justify-center rounded-lg text-white/75 hover:bg-white/10 hover:text-white"
          >
            <Menu className="h-5 w-5" strokeWidth={2} />
          </button>
          <p className="min-w-0 flex-1 truncate text-[1rem] font-semibold text-white">{current}</p>
          <a
            href={storefrontUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open the storefront in a new tab"
            className="btn-press flex h-11 w-11 items-center justify-center rounded-lg text-white/65 hover:bg-white/10 hover:text-white"
          >
            <ExternalLink className="h-5 w-5" strokeWidth={1.75} />
          </a>
        </div>

        {apiReachable ? null : (
          <div className="border-b border-gold-200 bg-gold-50 px-4 py-3 md:px-6">
            <p className="text-sm font-semibold text-gold-800">The API is unreachable</p>
            <p className="mt-0.5 text-sm text-gold-800/80">
              You are still signed in. Nothing on this screen can be read or saved until the API
              service is back; retrying is safe.
            </p>
          </div>
        )}

        {children}
      </div>

      {/* ---- the sheet (phone and tablet) -------------------------------- */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-navy-950/70 backdrop-blur-[2px]"
          />
          <div className="absolute inset-y-0 left-0 flex w-[19.5rem] max-w-[87vw] flex-col bg-navy-950 shadow-elevated">
            <div className="flex h-15 min-h-14 shrink-0 items-center justify-between pl-5 pr-2">
              <Wordmark size="sm" />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="btn-press flex h-11 w-11 items-center justify-center rounded-lg text-white/65 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>

            <NavList groups={groups} pathname={pathname} onNavigate={() => setMobileOpen(false)} />

            <div className="shrink-0 border-t border-white/10 p-2.5 pb-4">
              {admin ? (
                <p className="truncate px-3 pb-1 text-[0.75rem] text-white/35">{admin.email}</p>
              ) : null}
              <form action={adminPath('/api/admin/logout')} method="post">
                <button
                  type="submit"
                  className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[0.9375rem] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <LogOut className="h-[1.0625rem] w-[1.0625rem] shrink-0" strokeWidth={1.75} />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The content column.
 *
 * Exported separately because every screen needs its own header (title, actions,
 * filters) and the shell must not force one content layout on all of them. The
 * measure and the padding live in `.page-body` so a screen cannot drift from the
 * rest of the panel by hand-writing its own.
 */
export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="page-body">{children}</div>;
}
