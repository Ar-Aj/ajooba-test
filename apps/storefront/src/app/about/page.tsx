import type { Metadata } from 'next';
import Link from 'next/link';
import { ProsePage, ProseSection, ProseList } from '@/components/layout/prose-page';

export const metadata: Metadata = {
  title: 'About Ajooba Footwear',
  description:
    'The story of Ajooba Footwear — a small house of craftsmen in Uttar Pradesh making ethnic and contemporary footwear since 1986.',
  alternates: { canonical: '/about' },
};

export default function AboutPage() {
  return (
    <ProsePage
      title="The House of Ajooba"
      lede="A small house of craftsmen in Uttar Pradesh, making footwear the way it was made when we opened — one pair, one last, one pair of hands at a time."
    >
      <ProseSection heading="Our story">
        <p>
          Ajooba began in 1986 in a workshop the size of a room, with three lasts and a single
          pattern for a mojri. The workshop made shoes for the wedding season, and the people who
          wore them came back the following year for the same pair in a different colour.
        </p>
        <p>
          We have grown since then — different lasts, different materials, a far larger catalogue —
          but the discipline has not changed. A pair leaves the workshop only when it holds its
          shape on the last, when the stitching is even, and when the sole is properly stitched and
          cemented rather than just glued.
        </p>
      </ProseSection>

      <ProseSection heading="How we make things">
        <p>
          Every design starts as a paper pattern and a carved wooden last. The upper is cut and
          skived by hand, the brocade or leather is lasted and lasted again, and the embroidery —
          where a design calls for it — is worked by hand in zari or resham thread.
        </p>
        <ProseList
          items={[
            'Leather is vegetable-tanned and sourced from tanneries we have worked with for two decades.',
            'Embroidered panels are worked by hand, which is why no two pairs are identical in the stitching.',
            'Soles are stitched and cemented, so they can be resoled rather than replaced.',
            'We cut in small batches, so quantities of a design are genuinely limited.',
          ]}
        />
      </ProseSection>

      <ProseSection heading="How we size">
        <p>
          Sizes on this site are UK/India sizes (5 to 13). Our lasts run true to size with a
          slightly roomier toe box than most European brands, because that is what Indian feet tend
          to need. If you are between sizes, or have a wide foot, we recommend going up half a size.
        </p>
        <p>
          Every order includes a prepaid reverse pickup label, so trying a pair at home and sending
          it back costs you nothing.
        </p>
      </ProseSection>

      <ProseSection heading="Where we are">
        <p>
          Our workshop and packing unit are in Uttar Pradesh. We ship throughout India, and
          everything is packed by hand.
        </p>
        <p>
          Questions?{' '}
          <Link href="/contact" className="font-medium text-ink-900 underline underline-offset-4">
            Write to our customer care team
          </Link>{' '}
          and we will answer.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
