import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BarSeries, ProportionBar, Sparkline } from '@/components/ui/charts';
import { Figure, Metric } from '@/components/ui/metric';

/**
 * The project's no-fake-data rule, asserted against the dashboard's rendered
 * pieces and its source.
 *
 * Rule: no dummy catalogue, fake revenue, fake orders or fake customer analytics
 * may appear in a production-facing screen. Every figure on the dashboard is
 * derived from `GET /v1/admin/dashboard` at request time; there is no seeded
 * metrics collection and no fallback constant.
 *
 * These tests are the executable form of that rule, and they are written at two
 * levels because the rule can be broken in two different ways:
 *
 *  1. **In the rendering.** A component that invents a value the API did not
 *     return — a default `₹0`, a "conversion rate" nobody measures. Asserted by
 *     rendering the presentational pieces and by reading the page's source.
 *  2. **In the source.** A literal currency figure or a plausible-looking sample
 *     number typed into the page. Asserted by scanning the file.
 *
 * A rendered-output assertion alone would miss a constant that happens to be
 * overwritten by live data in the happy path and shown when the API is down.
 */

const DASHBOARD_SOURCE = readFileSync(
  path.resolve(import.meta.dirname, '../src/app/(panel)/page.tsx'),
  'utf8',
);

describe('the dashboard renders only what it was given', () => {
  it('prints the exact figure it is handed, and no other', () => {
    const html = renderToStaticMarkup(
      <Metric label="Revenue" value="₹1,39,900" context="Paid orders only" />,
    );

    expect(html).toContain('₹1,39,900');
    expect(html).toContain('Paid orders only');
    // No second currency figure invented alongside the real one.
    expect(html.match(/₹/g)).toHaveLength(1);
  });

  it('renders an empty series as an explicit zero line, not a fabricated curve', () => {
    const html = renderToStaticMarkup(<Sparkline data={[0, 0, 0, 0, 0]} />);

    // A dashed baseline is the honest drawing of "nothing happened".
    expect(html).toContain('<line');
    expect(html).toContain('stroke-dasharray');
    // Crucially: no filled area, which would suggest a shape that does not exist.
    expect(html).not.toContain('<path d="M');
  });

  it('draws a real series as a path and marks its final point', () => {
    const html = renderToStaticMarkup(<Sparkline data={[0, 1200, 0, 3400]} />);

    expect(html).toContain('<path');
    expect(html).toContain('<circle');
  });

  it('states plainly when a bar series has no activity', () => {
    const html = renderToStaticMarkup(
      <BarSeries data={[0, 0, 0]} labels={['a', 'b', 'c']} emptyLabel="No orders were placed" />,
    );

    expect(html).toContain('No orders were placed');
    // No bars at all, rather than three invisible ones implying a chart.
    expect(html).not.toContain('role="img"');
  });

  it('keeps a quiet status breakdown readable when every bucket is empty', () => {
    const html = renderToStaticMarkup(
      <ProportionBar
        segments={[
          { label: 'Placed', value: 0, className: 'bg-gold-400' },
          { label: 'Shipped', value: 0, className: 'bg-ink-500' },
        ]}
      />,
    );

    expect(html).toContain('bg-panel-200');
    expect(html).not.toContain('bg-gold-400');
  });

  it('marks a refund as money out, in words as well as tone', () => {
    const html = renderToStaticMarkup(<Figure label="Refunded" value="₹0" tone="fault" />);

    expect(html).toContain('Refunded');
    expect(html).toContain('₹0');
  });
});

describe('the dashboard source contains no invented figure', () => {
  it('has no literal rupee amount', () => {
    // Every currency value must travel through `rupees(...)`, which formats a
    // number the API supplied. A literal ₹ in this file is a fake number.
    expect(DASHBOARD_SOURCE).not.toMatch(/₹\s?\d/);
  });

  it('has no plausible-looking sample counts', () => {
    for (const fabricated of [
      '1,24,560',
      '124560',
      'sample revenue',
      'sample orders',
      'sample customers',
      'conversion rate',
      'Growth',
    ]) {
      expect(DASHBOARD_SOURCE).not.toContain(fabricated);
    }
  });

  it('reads every figure from the API client rather than a constant', () => {
    // The page must call the dashboard client; a page that renders metrics
    // without reading them is, by definition, inventing them.
    expect(DASHBOARD_SOURCE).toContain('fetchDashboard');
    expect(DASHBOARD_SOURCE).toContain('metrics.totalRevenue');
    expect(DASHBOARD_SOURCE).toContain('metrics.averageOrderValue');
  });

  it('says so out loud when there are no orders', () => {
    expect(DASHBOARD_SOURCE).toContain('No orders have been placed yet');
  });

  it('does not hardcode a storefront URL', () => {
    expect(DASHBOARD_SOURCE).not.toContain('http://localhost:');
    expect(DASHBOARD_SOURCE).not.toMatch(/https:\/\/[a-z]/);
  });
});
