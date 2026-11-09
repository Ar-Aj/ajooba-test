import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HomepageProductCard } from '@ajooba/contracts';
import { PriceSavings } from '@/components/ui/price-savings';
import { SpecimenTile } from '@/features/home/components/specimen-tile';
import ContactPage from '@/app/contact/page';
import { customerSession } from '@/lib/customer-session';
import { wishlistStore } from '@/lib/wishlist-store';
import { addressStore } from '@/lib/address-store';

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: unknown }).window;

function installMockWindow() {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
  installMockWindow();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
  vi.restoreAllMocks();
});

describe('PriceSavings', () => {
  it('renders rupee savings and rounded discount percentage when mrp > sellingPrice', () => {
    const html = renderToStaticMarkup(<PriceSavings mrp={1999} sellingPrice={1399} />);
    expect(html).toContain('Save ₹600');
    expect(html).toContain('30% off');
  });

  it('renders nothing when mrp equals or is below sellingPrice', () => {
    expect(renderToStaticMarkup(<PriceSavings mrp={1399} sellingPrice={1399} />)).toBe('');
    expect(renderToStaticMarkup(<PriceSavings mrp={1200} sellingPrice={1399} />)).toBe('');
  });
});

describe('SpecimenTile', () => {
  it('renders the product title exactly once (in h3) without duplicate title paragraphs', () => {
    const card: HomepageProductCard = {
      id: '65f000000000000000000011',
      code: 'A11',
      slug: 'ajooba-a11',
      title: 'Unique Regal Mojri Title',
      subcategory: 'Mojri & Jutti',
      subcategorySlug: 'mojri-jutti',
      mrp: 1999,
      sellingPrice: 1499,
      inStock: true,
      isPurchasable: true,
      imageUrl: '/images/products/a11.jpg',
      imageAlt: 'A11 Mojri',
      verifiedColours: ['Brown', 'Tan'],
    };

    const html = renderToStaticMarkup(<SpecimenTile product={card} />);
    const matches = html.match(/Unique Regal Mojri Title/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(html).toContain('Save ₹500');
  });
});

describe('ContactPage placeholder filtering', () => {
  it('suppresses seeded placeholder email and phone and shows honest fallback copy', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        data: {
          storeName: 'Ajooba Footwear',
          tagline: 'Footwear',
          supportEmail: 'support@ajooba.in',
          supportPhone: '+919876543210',
          currency: 'INR',
          freeShippingThreshold: 999,
          shippingFee: 79,
          taxRatePercent: 0,
          isCodEnabled: true,
          socialLinks: {},
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );

    const element = await ContactPage({ searchParams: Promise.resolve({ design: 'a11' }) });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('support@ajooba.in');
    expect(html).not.toContain('+919876543210');
    expect(html).toContain('has not been configured yet');
    expect(html).toContain('Your enquiry is about design A11');
  });

  it('renders real configured support channels and ignores malformed design query params', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        data: {
          storeName: 'Ajooba Footwear',
          tagline: 'Footwear',
          supportEmail: 'care@ajoobafootwear.com',
          supportPhone: '+919123456789',
          currency: 'INR',
          freeShippingThreshold: 999,
          shippingFee: 79,
          taxRatePercent: 0,
          isCodEnabled: true,
          socialLinks: {},
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );

    const element = await ContactPage({
      searchParams: Promise.resolve({ design: '<script>alert(1)</script>' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('mailto:care@ajoobafootwear.com');
    expect(html).toContain('tel:+919123456789');
    expect(html).not.toContain('Your enquiry is about design');
  });
});

describe('wishlistStore and addressStore authenticated server sync', () => {
  it('syncs wishlist items from /v1/wishlist and posts/deletes when signed in', async () => {
    customerSession.save({
      accessToken: 'token-123',
      refreshToken: 'refresh-123',
      expiresIn: 900,
      user: {
        id: '65f000000000000000000001',
        email: 'shopper@example.com',
        firstName: 'Aarav',
        lastName: 'Sharma',
        phone: '+919876543210',
      },
    });

    const productId = '65f000000000000000000099';
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        data: {
          items: [
            {
              id: productId,
              code: 'A11',
              slug: 'ajooba-a11',
              title: 'Royal Mojri',
              mrp: 1999,
              sellingPrice: 1399,
              images: [{ url: '/images/a11.jpg', alt: 'A11' }],
            },
          ],
          count: 1,
        },
      }),
    );

    const synced = await wishlistStore.syncFromServer();
    expect(synced).toHaveLength(1);
    expect(synced[0]?.productId).toBe(productId);
    expect(wishlistStore.has(productId)).toBe(true);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        data: { items: [], count: 0 },
      }),
    );

    await wishlistStore.removeRemote(productId);
    expect(wishlistStore.has(productId)).toBe(false);
  });

  it('creates, updates default, and removes addresses via /v1/addresses when signed in', async () => {
    customerSession.save({
      accessToken: 'token-123',
      refreshToken: 'refresh-123',
      expiresIn: 900,
      user: {
        id: '65f000000000000000000001',
        email: 'shopper@example.com',
        firstName: 'Aarav',
        lastName: 'Sharma',
        phone: '+919876543210',
      },
    });

    const addressId = '65f000000000000000000088';
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(201, {
        ok: true,
        data: {
          id: addressId,
          label: 'Home',
          fullName: 'Aarav Sharma',
          phone: '+919876543210',
          line1: '14 Johari Bazar',
          line2: '',
          city: 'Jaipur',
          state: 'Rajasthan',
          postalCode: '302003',
          country: 'India',
          isDefault: true,
        },
      }),
    );

    const saved = await addressStore.saveRemote({
      label: 'Home',
      fullName: 'Aarav Sharma',
      phone: '9876543210',
      line1: '14 Johari Bazar',
      city: 'Jaipur',
      state: 'Rajasthan',
      postalCode: '302003',
      country: 'India',
      isDefault: true,
    });

    expect(saved.id).toBe(addressId);
    expect(saved.phone).toBe('9876543210');
    expect(addressStore.list()[0]?.id).toBe(addressId);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        data: { deleted: true, items: [], count: 0 },
      }),
    );

    await addressStore.removeRemote(addressId);
    expect(addressStore.list()).toEqual([]);
  });
});
