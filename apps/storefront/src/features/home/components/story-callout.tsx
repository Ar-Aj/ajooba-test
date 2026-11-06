import Link from 'next/link';
import { Reveal } from '@/components/ui/reveal';

/**
 * The closing band.
 *
 * The direction's last section brings the object back one more time to settle
 * the page. Rather than a second photograph of a shoe, the object here is the
 * **last statement** the house makes — one sentence the brand is prepared to
 * defend, with the two facts that back it and a single way forward.
 *
 * The photograph slot is deliberately left to the creative work: until an
 * honest workshop image exists, this band is type on a tinted field. A stock
 * photograph of somebody else's factory would undo the whole page.
 */
export function StoryCallout() {
  return (
    <section className="bg-field-d" aria-label="About Ajooba Footwear">
      <div className="container-page grid grid-cols-1 items-center gap-10 py-16 md:grid-cols-12 md:gap-14 md:py-24">
        <Reveal className="md:col-span-7">
          <h2 className="step-xl max-w-xl text-ink-900">
            A pair that fits well
            <br />
            is its own sort of luxury.
          </h2>

          <p className="step-md mt-6 max-w-xl text-ink-600">
            Ajooba is a small house of craftsmen in Uttar Pradesh. We work in leather, suede and
            brocade, on lasts and patterns that have changed — if at all — by millimetres since we
            opened. Our craft is quiet, and our shoes wear in.
          </p>

          <Link
            href="/about"
            className="step-sm link-underline mt-8 inline-block pb-1 text-ink-800 hover:text-ink-950"
          >
            Read our story →
          </Link>
        </Reveal>

        <Reveal delay={120} className="md:col-span-5">
          <dl className="space-y-3">
            {[
              { term: 'Since', detail: '1986, in the same workshop' },
              { term: 'Made in', detail: 'Uttar Pradesh, India' },
              { term: 'Materials', detail: 'Leather, suede, brocade' },
            ].map((row) => (
              <div
                key={row.term}
                className="flex items-baseline justify-between gap-6 bg-cream-50 px-5 py-4"
              >
                <dt className="label-cap text-ink-500">{row.term}</dt>
                <dd className="step-sm text-ink-800">{row.detail}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
