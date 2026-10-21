import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminDashboardPage from '@/app/page';

/**
 * The project's no-fake-data rule, asserted against the rendered admin shell.
 *
 * Rule: no dummy catalogue, fake revenue, fake orders or fake customer
 * analytics may appear in a production-facing screen. These tests are the
 * executable form of that rule — if someone adds a hardcoded "₹1,24,560
 * revenue" tile later, this test fails.
 */

describe('AdminDashboardPage', () => {
  it('renders the empty state rather than fabricated metrics', () => {
    const html = renderToStaticMarkup(<AdminDashboardPage />);

    expect(html).toContain('No store data yet');
    expect(html).toContain(
      'this panel will not display sample revenue, sample orders or sample customers',
    );
  });

  it('renders no currency figure at all', () => {
    const html = renderToStaticMarkup(<AdminDashboardPage />);

    // The rupee sign must not appear anywhere on the dashboard.
    expect(html).not.toContain('₹');
  });

  it('renders no fabricated order or customer counts', () => {
    const html = renderToStaticMarkup(<AdminDashboardPage />);

    for (const fabricated of [
      'Orders today',
      'Total orders',
      'Customers',
      'Revenue',
      'Avg. order value',
      'Conversion rate',
      'Growth',
    ]) {
      expect(html).not.toContain(fabricated);
    }
  });

  it('renders no chart or graph container', () => {
    const html = renderToStaticMarkup(<AdminDashboardPage />);

    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<canvas');
  });

  it('does not hardcode a localhost storefront URL', () => {
    const html = renderToStaticMarkup(<AdminDashboardPage />);

    // The storefront link comes from NEXT_PUBLIC_SITE_URL, never a literal.
    expect(html).not.toContain('http://localhost:3000');
  });

  it('links to platform health endpoints built from validated env', () => {
    const html = renderToStaticMarkup(<AdminDashboardPage />);

    expect(html).toContain('http://localhost:4000/health/ready');
    expect(html).toContain('href="/api/health"');
  });
});
