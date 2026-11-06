'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { CategoryView } from '@ajooba/contracts';
import { Logo } from '@/components/brand/logo';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { useCommerce } from '@/lib/commerce-context';
import { useHydrated } from '@/lib/use-hydrated';
import { accountStore } from '@/lib/account-store';
import { cartStore } from '@/lib/cart-store';
import { mediaUrl } from '@/lib/media';
import { rupees } from '@/lib/format';
import { cn } from '@/lib/cn';
import { trackSearch, trackTap } from '@/lib/track';
import { TapLink } from '@/components/track/tap-link';

/**
 * The storefront header.
 *
 * ## Categories come from the API, not from this file
 *
 * The rail, the mobile sheet and the search suggestions all read the live
 * taxonomy handed down from the root layout. There is no category name and no
 * category slug written down in this file: adding a category in the admin makes
 * it appear here on the next request, which is what "one taxonomy" is supposed
 * to mean.
 *
 * ## Shape
 *
 * Two bands. A dark utility strip carries the shipping promise and the help
 * links; it is desktop only, because on a phone that row would push the
 * wordmark below the fold for the sake of a phone number nobody taps. The main
 * band is the brand ground with a hairline that only appears once the page has
 * scrolled, so the first screen is not divided by a line it does not need.
 *
 * ## Four overlays, four independent pieces of state
 *
 * Mobile navigation, cart, search and the account menu each own their state, so
 * opening the cart cannot close a menu the shopper is still reading.
 */
export function SiteHeader({ categories }: { categories: readonly CategoryView[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const { cartCount, wishlist, account, ready } = useCommerce();
  const { toast } = useToast();

  /*
   * The header must render the *server's* numbers until it has finished
   * hydrating, and only then show what is saved on this device.
   *
   * This component sits inside a `Suspense` boundary because it reads
   * `useSearchParams`. React can therefore hydrate the provider, read the
   * visitor's saved wishlist, and hydrate this header afterwards — at which point
   * `wishlist.length` is already 1 while the HTML on screen says 0, and React
   * fails the hydration:
   *
   *     aria-label="Wishlist, 1 saved" (client) vs "Wishlist, 0 saved" (server)
   *
   * `useHydrated` answers the question per component rather than per provider,
   * which is the only place the answer is meaningful. `ready` from context is
   * checked too, so a device read that has not landed yet also renders zeros.
   */
  const hydrated = useHydrated();
  const deviceKnown = hydrated && ready;
  const savedCount = deviceKnown ? wishlist.length : 0;
  const bagCount = deviceKnown ? cartCount : 0;

  const [mobileOpen, setMobileOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [condensed, setCondensed] = useState(false);

  const activeSlug = params.get('subcategory');
  const onShop = pathname.startsWith('/products') || pathname.startsWith('/search');

  // Close every overlay when the route changes.
  useEffect(() => {
    setMobileOpen(false);
    setCartOpen(false);
    setSearchOpen(false);
    setAccountOpen(false);
    setShopOpen(false);
  }, [pathname, params]);

  /*
   * One passive listener for the whole header. The condensed state is what
   * turns the hairline on and shrinks the band by 12px, which is enough to
   * recover a line of product on a laptop without the bar visibly jumping.
   */
  useEffect(() => {
    const onScroll = () => setCondensed(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Escape closes the shop panel, matching every other surface.
  useEffect(() => {
    if (!shopOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShopOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shopOpen]);

  const totalItems = categories.reduce((total, category) => total + category.productCount, 0);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-2 focus-visible:top-2 focus-visible:z-50 focus-visible:bg-ink-900 focus-visible:px-4 focus-visible:py-2 focus-visible:text-cream-50"
      >
        Skip to main content
      </a>

      <header
        className={cn(
          'sticky top-0 z-40 bg-cream-50 transition-shadow duration-200',
          condensed ? 'rule-b' : '',
        )}
      >
        {/* --- utility strip: desktop only --------------------------------- */}
        <div className="hidden bg-ink-900 text-cream-50 lg:block">
          <div className="container-page flex h-9 items-center justify-between text-[0.6875rem] tracking-[0.12em] uppercase">
            <p>Made in Uttar Pradesh · Free shipping over ₹1,499</p>
            <div className="flex items-center gap-6">
              <Link href="/" className="hover:text-gold-300">
                Home
              </Link>
              <a href="tel:+918000012345" className="hover:text-gold-300">
                +91 80000 12345
              </a>
              <Link href="/contact" className="hover:text-gold-300">
                Contact
              </Link>
              <Link href="/about" className="hover:text-gold-300">
                The house
              </Link>
            </div>
          </div>
        </div>

        {/* --- main band --------------------------------------------------- */}
        <div
          className={cn(
            'container-page flex items-center gap-4 transition-[height] duration-200',
            condensed ? 'h-14 md:h-16' : 'h-16 md:h-20',
          )}
        >
          <button
            type="button"
            className="-ml-2 p-2 text-ink-900 lg:hidden"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Icon name="menu" />
          </button>

          <Logo className="lg:mr-6" />

          <div className="flex items-center gap-4 lg:hidden">
            <Link
              href="/"
              aria-current={pathname === '/' ? 'page' : undefined}
              className={cn(
                'link-underline step-sm py-1 font-medium',
                pathname === '/' ? 'text-ink-900' : 'text-ink-700 hover:text-ink-900',
              )}
            >
              Home
            </Link>
            <Link
              href="/products"
              aria-current={onShop && !activeSlug ? 'page' : undefined}
              className={cn(
                'link-underline step-sm hidden py-1 sm:inline-block',
                onShop && !activeSlug ? 'text-ink-900' : 'text-ink-700 hover:text-ink-900',
              )}
            >
              Shop all
            </Link>
          </div>

          {/* --- primary category rail ------------------------------------- */}
          <nav aria-label="Primary" className="hidden flex-1 items-center gap-7 lg:flex">
            <Link
              href="/"
              aria-current={pathname === '/' ? 'page' : undefined}
              className={cn(
                'link-underline step-sm py-2 font-medium',
                pathname === '/' ? 'text-ink-900' : 'text-ink-700 hover:text-ink-900',
              )}
            >
              Home
            </Link>

            <div
              className="relative"
              onMouseEnter={() => setShopOpen(true)}
              onMouseLeave={() => setShopOpen(false)}
            >
              <Link
                href="/products"
                aria-current={onShop && !activeSlug ? 'page' : undefined}
                aria-expanded={shopOpen}
                className={cn(
                  'link-underline step-sm inline-flex items-center gap-1.5 py-2',
                  onShop && !activeSlug ? 'text-ink-900' : 'text-ink-600 hover:text-ink-900',
                )}
              >
                Shop all
                <Icon name="chevron" className="h-3 w-3" />
              </Link>

              {/*
                The panel is a real list of the live categories with their live
                counts. It is anchored under the rail rather than full-bleed,
                because a full-bleed mega menu over a four-category catalogue
                would be a large empty rectangle.
              */}
              {shopOpen && categories.length > 0 ? (
                <div className="absolute left-0 top-full z-50 w-[30rem] pt-3">
                  <div className="bg-cream-50 p-6 shadow-elevated">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                      {categories.map((category) => (
                        <TapLink
                          key={category.slug}
                          href={`/products?subcategory=${encodeURIComponent(category.slug)}`}
                          action="category-open"
                          surface="header"
                          detail={{
                            categorySlug: category.slug,
                            categoryName: category.displayName,
                          }}
                          className="group flex items-baseline justify-between gap-3 py-2"
                        >
                          <span className="step-sm text-ink-800 group-hover:text-ink-950">
                            {category.displayName}
                          </span>
                          <span className="step-xs tnum text-ink-400">{category.productCount}</span>
                        </TapLink>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                      <Link href="/products" className="step-xs text-ink-500 hover:text-ink-900">
                        {totalItems} designs in total
                      </Link>
                      <Link
                        href="/products?sort=newest"
                        className="step-xs text-ink-800 hover:text-ink-950"
                      >
                        Newest first →
                      </Link>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {categories.slice(0, 3).map((category) => (
              <TapLink
                key={category.slug}
                href={`/products?subcategory=${encodeURIComponent(category.slug)}`}
                action="category-open"
                surface="header"
                detail={{
                  categorySlug: category.slug,
                  categoryName: category.displayName,
                }}
                aria-current={activeSlug === category.slug ? 'page' : undefined}
                className={cn(
                  'link-underline step-sm py-2',
                  activeSlug === category.slug ? 'text-ink-900' : 'text-ink-600 hover:text-ink-900',
                )}
              >
                {category.displayName}
              </TapLink>
            ))}

            <Link
              href="/about"
              aria-current={pathname === '/about' ? 'page' : undefined}
              className="link-underline step-sm py-2 text-ink-600 hover:text-ink-900"
            >
              The House of Ajooba
            </Link>
          </nav>

          {/* --- utilities -------------------------------------------------- */}
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              className="p-2.5 text-ink-700 hover:text-ink-950"
              aria-label="Search products"
              onClick={() => setSearchOpen(true)}
            >
              <Icon name="search" />
            </button>

            <Link
              href="/account/wishlist"
              className="relative hidden p-2.5 text-ink-700 hover:text-ink-950 sm:inline-flex"
              aria-label={`Wishlist, ${savedCount} saved`}
            >
              <Icon name="heart" />
              {savedCount > 0 ? <Count value={savedCount} tone="gold" /> : null}
            </Link>

            <div className="relative hidden sm:block">
              <button
                type="button"
                onClick={() => setAccountOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                className="p-2.5 text-ink-700 hover:text-ink-950"
                aria-label="Account"
              >
                <Icon name="user" />
              </button>
              {accountOpen ? (
                <AccountMenu
                  account={account}
                  onClose={() => setAccountOpen(false)}
                  onSignOut={() => {
                    accountStore.signOut();
                    setAccountOpen(false);
                    toast({
                      title: 'Signed out',
                      description: 'Your cart is still saved on this device.',
                      tone: 'info',
                    });
                  }}
                />
              ) : null}
            </div>

            <button
              type="button"
              className="relative p-2.5 text-ink-700 hover:text-ink-950"
              aria-label={`Cart, ${bagCount} ${bagCount === 1 ? 'item' : 'items'}`}
              onClick={() => setCartOpen(true)}
            >
              <Icon name="bag" />
              {bagCount > 0 ? <Count value={bagCount} tone="ink" /> : null}
            </button>
          </div>
        </div>
      </header>

      <MobileNav
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        categories={categories}
        onSearch={() => {
          setMobileOpen(false);
          setSearchOpen(true);
        }}
      />

      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        value={search}
        onChange={setSearch}
        categories={categories}
        onSubmit={() => {
          const term = search.trim();
          if (term.length === 0) return;
          trackSearch(term);
          setSearchOpen(false);
          router.push(`/search?q=${encodeURIComponent(term)}`);
        }}
        onCategory={(slug) => {
          setSearchOpen(false);
          trackTap('category-open', 'search-results', { categorySlug: slug });
          router.push(`/products?subcategory=${encodeURIComponent(slug)}`);
        }}
      />

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onCheckout={() => {
          setCartOpen(false);
          router.push('/checkout');
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Small shared pieces                                                        */
/* -------------------------------------------------------------------------- */

/** The notification bubble. Two tones: gold for saved, ink for the cart. */
function Count({ value, tone }: { value: number; tone: 'gold' | 'ink' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'tnum absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center px-1 text-[0.625rem] font-semibold leading-none',
        tone === 'gold' ? 'bg-gold-500 text-ink-900' : 'bg-ink-900 text-cream-50',
      )}
    >
      {value > 99 ? '99+' : value}
    </span>
  );
}

function AccountMenu({
  account,
  onClose,
  onSignOut,
}: {
  account: { fullName: string; email: string } | null;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const links = [
    { href: '/account', label: 'Overview' },
    { href: '/account/orders', label: 'Orders' },
    { href: '/account/returns', label: 'Returns' },
    { href: '/account/addresses', label: 'Addresses' },
    { href: '/account/wishlist', label: 'Wishlist' },
  ];

  return (
    <div
      role="menu"
      className="absolute right-0 top-full z-50 mt-1 w-60 bg-cream-50 shadow-elevated"
    >
      <div className="px-4 py-3">
        {account ? (
          <>
            <p className="step-sm font-medium text-ink-900">{account.fullName}</p>
            <p className="step-xs mt-0.5 truncate text-ink-500">{account.email}</p>
          </>
        ) : (
          <>
            <p className="step-sm font-medium text-ink-900">Not signed in</p>
            <p className="step-xs mt-0.5 text-ink-500">Sign in to track orders</p>
          </>
        )}
      </div>
      <div className="h-px bg-border" />
      <ul className="py-1">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              role="menuitem"
              onClick={onClose}
              className="step-sm block px-4 py-2 text-ink-700 hover:bg-cream-100 hover:text-ink-950"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="h-px bg-border" />
      {account ? (
        <button
          type="button"
          role="menuitem"
          onClick={onSignOut}
          className="step-sm block w-full px-4 py-3 text-left text-claret-700 hover:bg-cream-100"
        >
          Sign out
        </button>
      ) : (
        <Link
          href="/login"
          role="menuitem"
          onClick={onClose}
          className="step-sm block px-4 py-3 text-ink-900 hover:bg-cream-100"
        >
          Sign in
        </Link>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Mobile navigation                                                          */
/* -------------------------------------------------------------------------- */

function MobileNav({
  open,
  onClose,
  categories,
  onSearch,
}: {
  open: boolean;
  onClose: () => void;
  categories: readonly CategoryView[];
  onSearch: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} side="left" title="Browse" width="max-w-sm">
      <button
        type="button"
        onClick={() => {
          trackTap('nav-open', 'header');
          onSearch();
        }}
        className="step-sm mb-6 flex w-full items-center gap-3 border-b border-border pb-3 text-left text-ink-500"
      >
        <Icon name="search" className="h-4 w-4" />
        Search the catalogue
      </button>

      <Link
        href="/"
        onClick={onClose}
        className="step-md mb-4 flex items-center justify-between border-b border-border pb-3 text-ink-900"
      >
        Home
        <span aria-hidden="true" className="step-xs text-ink-400">
          →
        </span>
      </Link>

      <p className="label-cap mb-2 text-ink-400">Shop</p>
      <ul>
        <li>
          <TapLink
            href="/products"
            action="category-open"
            surface="header"
            className="step-md flex items-baseline justify-between py-3 text-ink-900"
          >
            All footwear
            <span className="step-xs tnum text-ink-400">
              {categories.reduce((total, category) => total + category.productCount, 0)}
            </span>
          </TapLink>
        </li>
        {categories.map((category) => (
          <li key={category.slug}>
            <TapLink
              href={`/products?subcategory=${encodeURIComponent(category.slug)}`}
              action="category-open"
              surface="header"
              detail={{ categorySlug: category.slug, categoryName: category.displayName }}
              className="step-md flex items-baseline justify-between py-3 text-ink-900"
            >
              {category.displayName}
              <span className="step-xs tnum text-ink-400">{category.productCount}</span>
            </TapLink>
          </li>
        ))}
      </ul>

      <div className="my-5 h-px bg-border" />

      <p className="label-cap mb-2 text-ink-400">Account</p>
      <ul>
        {[
          { href: '/account', label: 'Overview' },
          { href: '/account/orders', label: 'Orders' },
          { href: '/account/returns', label: 'Returns' },
          { href: '/account/wishlist', label: 'Wishlist' },
          { href: '/login', label: 'Sign in' },
        ].map((link) => (
          <li key={link.href}>
            <Link href={link.href} onClick={onClose} className="step-sm block py-2.5 text-ink-700">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="my-5 h-px bg-border" />

      <p className="label-cap mb-2 text-ink-400">The house</p>
      <ul>
        {[
          { href: '/about', label: 'About Ajooba' },
          { href: '/contact', label: 'Contact' },
          { href: '/shipping', label: 'Shipping' },
          { href: '/returns', label: 'Returns' },
        ].map((link) => (
          <li key={link.href}>
            <Link href={link.href} onClick={onClose} className="step-sm block py-2.5 text-ink-700">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

function SearchOverlay({
  open,
  onClose,
  value,
  onChange,
  categories,
  onSubmit,
  onCategory,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (value: string) => void;
  categories: readonly CategoryView[];
  onSubmit: () => void;
  onCategory: (slug: string) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      document.getElementById('site-search-input')?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} side="top" title="Search" width="max-w-3xl">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor="site-search-input" className="sr-only">
          Search products
        </label>
        <div className="flex items-center gap-3 border-b border-ink-300 pb-2 focus-within:border-ink-900">
          <Icon name="search" className="h-5 w-5 text-ink-400" />
          <input
            id="site-search-input"
            type="search"
            autoComplete="off"
            placeholder="Mojri, jutti, tan, size 9…"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="step-lg w-full bg-transparent py-2 text-ink-900 placeholder:text-ink-300 focus:outline-none"
          />
        </div>

        <p className="step-xs mt-3 text-ink-500">
          Try a design code (<span className="text-ink-700">A48</span>), a colour, or a category
          name.
        </p>

        {categories.length > 0 ? (
          <div className="mt-6">
            <p className="label-cap mb-3 text-ink-400">Or start from a category</p>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <button
                  key={category.slug}
                  type="button"
                  onClick={() => onCategory(category.slug)}
                  className="step-sm btn-press bg-cream-100 px-3 py-1.5 text-ink-800 hover:bg-cream-200"
                >
                  {category.displayName}
                  <span className="tnum ml-2 text-ink-400">{category.productCount}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-8 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="step-sm px-4 py-2 text-ink-600">
            Cancel
          </button>
          <button
            type="submit"
            disabled={value.trim().length === 0}
            className="btn-press step-sm bg-ink-900 px-6 py-2.5 font-medium text-cream-50 hover:bg-ink-800 disabled:opacity-40"
          >
            Search
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Cart drawer                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The cart drawer.
 *
 * Quantity is editable here rather than only on the cart page. A shopper who
 * opens the drawer to check what they have almost always wants to correct a
 * quantity, and sending them to a separate page to do it is the kind of small
 * insult that loses an order.
 *
 * Every write goes through `cartStore`, which is the same store the cart page
 * and checkout read, so the drawer can never display a total the rest of the
 * app disagrees with.
 */
function CartDrawer({
  open,
  onClose,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  onCheckout: () => void;
}) {
  const { cart, cartSubtotal, cartCount } = useCommerce();

  const shippingNote = useMemo(() => {
    const threshold = 1499;
    if (cartSubtotal >= threshold) return 'Free shipping on this order.';
    const remaining = threshold - cartSubtotal;
    return `${rupees(remaining)} more for free shipping.`;
  }, [cartSubtotal]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="right"
      title={`Your cart${cartCount > 0 ? ` (${cartCount})` : ''}`}
      footer={
        cart.length === 0 ? null : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="step-sm text-ink-600">Subtotal</span>
              <span className="tnum step-lg text-ink-900">{rupees(cartSubtotal)}</span>
            </div>
            <p className="step-xs mt-1 text-ink-500">{shippingNote}</p>
            <button
              type="button"
              onClick={onCheckout}
              className="btn-press step-sm mt-4 w-full bg-ink-900 py-3 font-medium text-cream-50 hover:bg-ink-800"
            >
              Checkout
            </button>
            <Link
              href="/cart"
              onClick={onClose}
              className="step-xs mt-3 block text-center text-ink-600 underline underline-offset-4 hover:text-ink-900"
            >
              View the full cart
            </Link>
          </>
        )
      }
    >
      {cart.length === 0 ? (
        <div className="py-10 text-center">
          <p className="step-lg text-ink-900">Nothing in the bag yet</p>
          <p className="step-sm mx-auto mt-2 max-w-xs text-ink-500">
            Every pair is photographed before it is listed. Browse the catalogue and start with one
            design.
          </p>
          <Link
            href="/products"
            onClick={onClose}
            className="btn-press step-sm mt-6 inline-flex bg-ink-900 px-6 py-3 font-medium text-cream-50 hover:bg-ink-800"
          >
            Browse the catalogue
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {cart.map((line) => (
            <li key={line.id} className="flex gap-4 py-4 first:pt-0">
              <Link
                href={`/products/${line.productSlug}`}
                onClick={onClose}
                className="specimen h-24 w-20 shrink-0"
              >
                {line.imageUrl ? (
                  <img
                    src={mediaUrl(line.imageUrl)}
                    alt={line.imageAlt ?? line.productTitle}
                    width={160}
                    height={192}
                  />
                ) : null}
              </Link>

              <div className="flex min-w-0 flex-1 flex-col">
                <Link
                  href={`/products/${line.productSlug}`}
                  onClick={onClose}
                  className="step-sm line-clamp-2 font-medium text-ink-900 hover:text-ink-950"
                >
                  {line.productTitle}
                </Link>
                <p className="step-xs mt-1 text-ink-500">
                  {line.colour} · UK {line.size}
                </p>

                <div className="mt-auto flex items-end justify-between gap-3 pt-3">
                  <div className="flex items-center border border-border">
                    <button
                      type="button"
                      onClick={() => cartStore.updateQuantity(line.id, line.quantity - 1)}
                      aria-label={`Decrease quantity of ${line.productTitle}`}
                      className="h-8 w-8 text-ink-600 hover:bg-cream-100 hover:text-ink-900"
                    >
                      −
                    </button>
                    <span className="tnum step-xs w-8 text-center text-ink-900">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => cartStore.updateQuantity(line.id, line.quantity + 1)}
                      disabled={line.quantity >= 10}
                      aria-label={`Increase quantity of ${line.productTitle}`}
                      className="h-8 w-8 text-ink-600 hover:bg-cream-100 hover:text-ink-900 disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                  <p className="tnum step-sm text-ink-900">
                    {rupees(line.unitPrice * line.quantity)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => cartStore.remove(line.id)}
                  className="step-xs mt-2 self-start text-ink-400 underline underline-offset-2 hover:text-claret-700"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Icons                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The header's icon set.
 *
 * Five line icons at a 1.5px stroke, drawn inline. A stroke-based set on a
 * 20px grid keeps the band quiet at the top of every page; filled icons at this
 * size read as buttons competing with the wordmark.
 */
function Icon({ name, className }: { name: IconName; className?: string }) {
  const shared = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    className,
  };

  switch (name) {
    case 'menu':
      return (
        <svg {...shared}>
          <path d="M3 7h18M3 12h18M3 17h18" />
        </svg>
      );
    case 'search':
      return (
        <svg {...shared}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.6-3.6" />
        </svg>
      );
    case 'heart':
      return (
        <svg {...shared}>
          <path d="M19.4 14.1c1.5-1.5 2.6-3.1 2.6-5.1A5 5 0 0 0 17 4c-1.7 0-3 .6-4.5 2.1C11 4.6 9.7 4 8 4a5 5 0 0 0-5 5c0 2 1.1 3.6 2.6 5.1L12 21Z" />
        </svg>
      );
    case 'user':
      return (
        <svg {...shared}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
        </svg>
      );
    case 'bag':
      return (
        <svg {...shared}>
          <path d="M5 8h14l-1 12H6L5 8Z" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case 'chevron':
      return (
        <svg {...shared}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
  }
}

type IconName = 'menu' | 'search' | 'heart' | 'user' | 'bag' | 'chevron';
