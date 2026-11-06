import { mediaUrl } from '@/lib/media';

/**
 * The opening banner.
 *
 * One picture, one headline. The banner artwork ships in `public/banner/` and
 * is authored at 1672x941 — exactly 16:9 — so the frame can be pinned to that
 * ratio at every screen size with the picture rendered whole: never letterboxed,
 * never cropped, never distorted.
 *
 * This used to be a three-slide carousel. It is a single slide on purpose: a
 * carousel asks the visitor to wait for the message they came for, and on a page
 * that has one thing to say the second and third slides were only delaying the
 * first.
 */
export interface HeroSlide {
  src: string;
  alt: string;
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}

/**
 * The banner artwork. `mediaUrl` prefixes the media base URL so this keeps
 * working when the assets move behind a CDN.
 */
export const HERO_BANNER: HeroSlide = {
  src: mediaUrl('/banner/banner home hero 1.png'),
  alt: 'Ajooba Footwear collection banner',
  eyebrow: 'The festive edit',
  title: 'Hand-finished mojris for the celebrations ahead',
  body: 'Embroidered uppers, cushioned soles, and the kind of detail you notice only when you take them off.',
  ctaLabel: 'Shop the collection',
  ctaHref: '/products?subcategory=mojri-jutti',
  secondaryLabel: 'View all footwear',
  secondaryHref: '/products',
};
