import type { Metadata } from 'next';
import type { ResolvedHomepageSection } from '@ajooba/contracts';
import { HeroBanner } from '@/features/home/components/hero-banner';
import { StoryCallout } from '@/features/home/components/story-callout';
import { TrustBand } from '@/features/home/components/trust-band';
import { HomepageSectionRenderer } from '@/features/home/components/homepage-section';
import { Ajooba3DShowcase } from '@/features/home/components/ajooba-3d-showcase';
import {
  SavingsAvailabilitySection,
  SizeAvailabilitySection,
} from '@/features/home/components/availability-sections';
import { Marquee } from '@/features/home/components/marquee';
import { colourwaysOf } from '@/lib/colour-swatch';
import { fetchCatalogueIndex, fetchHomepage } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Ajooba Footwear — Hand-finished ethnic footwear, mojris and chappals',
  description:
    'Shop hand-embroidered mojris, juttis, sandals and chappals from Ajooba Footwear. Made in Uttar Pradesh. Free shipping across India.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Ajooba Footwear',
    description: 'Hand-finished ethnic footwear, mojris, juttis, sandals and chappals.',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
};

/**
 * Which live sections contribute their text to the announcement strip.
 */
function marqueeMessages(sections: ResolvedHomepageSection[]): string[] {
  const messages: string[] = [];

  for (const section of sections) {
    if (section.type === 'deal' && section.heading) {
      messages.push(section.heading);
    } else if (section.type === 'featured' && section.heading) {
      const normalized = section.heading.trim().toLowerCase();
      messages.push(
        normalized === 'the ajooba edit'
          ? "Ajooba's Mehbooba · Multi-Shade Buying Studio"
          : section.heading,
      );
    }
  }

  return [...new Set(messages)].slice(0, 4);
}

/**
 * The storefront homepage.
 */
export default async function HomePage() {
  const [sections, productById] = await Promise.all([fetchHomepage(), fetchCatalogueIndex()]);

  const merchandising = sections.filter((section) => section.type !== 'hero');
  const hasFeaturedSection = merchandising.some((section) => section.type === 'featured');
  const allProducts = Object.values(productById);
  const fallbackShowcaseProducts = allProducts
    .filter((product) => colourwaysOf(product).length >= 2)
    .slice(0, 1);

  return (
    <>
      <HeroBanner />

      {marqueeMessages(merchandising).length > 0 ? (
        <Marquee items={marqueeMessages(merchandising)} />
      ) : null}

      {merchandising.map((section) => (
        <HomepageSectionRenderer key={section.id} section={section} productById={productById} />
      ))}

      {!hasFeaturedSection && fallbackShowcaseProducts.length > 0 ? (
        <Ajooba3DShowcase products={fallbackShowcaseProducts} />
      ) : null}

      {allProducts.length > 0 ? (
        <>
          <SizeAvailabilitySection products={allProducts} />
          <SavingsAvailabilitySection products={allProducts} />
        </>
      ) : null}

      <TrustBand />
      <StoryCallout />
    </>
  );
}
