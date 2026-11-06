import Link from 'next/link';
import type { CategoryView } from '@ajooba/contracts';
import { Logo } from '@/components/brand/logo';
import { AccessibilityControls } from '@/components/a11y/accessibility-controls';

/**
 * The storefront footer.
 *
 * The "Shop" column is built from the live taxonomy passed down from the root
 * layout. It used to be a hardcoded array of four slugs — the third of three
 * copies — which meant a category created in the admin appeared in the header
 * and not here. Now there is exactly one list.
 *
 * Everything below the columns is the legal and reassurance line: made-in,
 * payment methods, and the display controls. Those belong at the very end of a
 * page because nobody reads them first.
 */
export function SiteFooter({ categories }: { categories: readonly CategoryView[] }) {
  const shopLinks = [
    { href: '/products', label: 'All footwear' },
    ...categories.map((category) => ({
      href: `/products?subcategory=${encodeURIComponent(category.slug)}`,
      label: category.displayName,
    })),
  ];

  const columns = [
    { title: 'Shop', links: shopLinks },
    {
      title: 'Customer care',
      links: [
        { href: '/shipping', label: 'Shipping' },
        { href: '/returns', label: 'Returns' },
        { href: '/refund-policy', label: 'Refunds' },
        { href: '/contact', label: 'Contact us' },
      ],
    },
    {
      title: 'The house',
      links: [
        { href: '/about', label: 'About Ajooba' },
        { href: '/about#story', label: 'Our story' },
        { href: '/privacy', label: 'Privacy' },
        { href: '/terms', label: 'Terms of use' },
      ],
    },
  ];

  return (
    <footer className="mt-24 bg-ink-900 text-cream-50">
      <div className="container-page grid grid-cols-2 gap-x-8 gap-y-12 py-16 md:grid-cols-4 md:py-20">
        {/* The wordmark column doubles as the newsletter, because a footer
            signup is the only place a shopper expects to be asked. */}
        <div className="col-span-2 md:col-span-1 md:pr-6">
          <Logo variant="inverse" className="mb-5" />
          <p className="step-sm max-w-xs text-cream-50/70">
            Hand-finished ethnic and contemporary footwear, made in Uttar Pradesh for Indian feet
            and Indian occasions.
          </p>

          <form className="mt-7 max-w-xs" action="/contact" method="get">
            <label htmlFor="footer-email" className="label-cap mb-2 block text-cream-50/50">
              New collections
            </label>
            <div className="flex border-b border-cream-50/25 focus-within:border-gold-400">
              <input
                id="footer-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="your@email.in"
                className="step-sm flex-1 bg-transparent py-2.5 text-cream-50 placeholder:text-cream-50/35 focus:outline-none"
                required
              />
              <button
                type="submit"
                className="step-xs btn-press px-2 font-medium tracking-[0.14em] uppercase text-gold-300 hover:text-gold-200"
              >
                Join
              </button>
            </div>
          </form>

          <div className="mt-7 flex items-center gap-3">
            <span className="label-cap text-cream-50/40">Display</span>
            <AccessibilityControls variant="inverse" />
          </div>
        </div>

        {columns.map((column) => (
          <div key={column.title}>
            <h3 className="label-cap mb-5 text-cream-50/50">{column.title}</h3>
            <ul className="space-y-3">
              {column.links.map((link) => (
                <li key={link.href + link.label}>
                  <Link
                    href={link.href}
                    className="step-sm link-underline text-cream-50/80 hover:text-cream-50"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-cream-50/10">
        <div className="container-page flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="step-xs text-cream-50/50">
            © {new Date().getFullYear()} Ajooba Footwear. All rights reserved.
          </p>
          <p className="step-xs flex flex-wrap items-center gap-x-3 gap-y-1 text-cream-50/50">
            <span>Made in Uttar Pradesh, India</span>
            <span aria-hidden="true" className="text-cream-50/25">
              ·
            </span>
            <span>UPI · Cards · Net-banking · Cash on delivery</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
