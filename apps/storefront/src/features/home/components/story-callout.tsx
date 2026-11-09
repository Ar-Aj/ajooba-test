import Link from 'next/link';
import { Reveal } from '@/components/ui/reveal';

/**
 * The closing band points shoppers back to live catalogue and order information.
 */
export function StoryCallout() {
  return (
    <section className="bg-field-d" aria-label="About Ajooba Footwear">
      <div className="container-page grid grid-cols-1 items-center gap-10 py-16 md:grid-cols-12 md:gap-14 md:py-24">
        <Reveal className="md:col-span-7">
          <h2 className="step-xl max-w-xl text-ink-900">Find a pair for the moments ahead.</h2>

          <p className="step-md mt-6 max-w-xl text-ink-600">
            Explore the current collection, compare the available sizes and colours, then review the
            delivery charge and final total at checkout.
          </p>

          <Link
            href="/about"
            className="step-sm link-underline mt-8 inline-block pb-1 text-ink-800 hover:text-ink-950"
          >
            Browse footwear →
          </Link>
        </Reveal>

        <Reveal delay={120} className="md:col-span-5">
          <dl className="space-y-3">
            {[
              { term: 'Product details', detail: 'Current colours and sizes' },
              { term: 'Order total', detail: 'Confirmed at checkout' },
              { term: 'Size exchange', detail: 'Request within 10 days' },
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
