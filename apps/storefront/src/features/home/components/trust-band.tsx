import { Reveal } from '@/components/ui/reveal';

/**
 * The three promises, stated plainly.
 *
 * A hairline-separated row on the page ground rather than three bordered cards.
 * Three identical boxes side by side is the most generic arrangement in
 * commerce design; the same information set on the page with a rule between
 * items reads as a shop notice, which is what it is.
 *
 * Nothing here is a claim the business has not already published: the shipping
 * threshold and the return window match `docs/` and the policy pages.
 */
const PROMISES = [
  {
    title: 'Made for Indian feet',
    body: 'Lasts developed over decades, fitted to Indian widths and arches — not adapted from Western patterns.',
  },
  {
    title: 'Free shipping over ₹1,499',
    body: 'No-questions delivery on orders above ₹1,499. Below that, a flat courier fee applies.',
  },
  {
    title: 'Returns within 10 days',
    body: 'If the fit is off, send it back with the prepaid label included in your box.',
  },
];

export function TrustBand() {
  return (
    <section className="bg-field-a" aria-label="Our promises">
      <div className="container-page grid gap-8 py-12 sm:grid-cols-3 sm:gap-10 sm:py-14">
        {PROMISES.map((promise, index) => (
          <Reveal key={promise.title} delay={index * 80}>
            <h3 className="step-lg font-medium text-ink-900">{promise.title}</h3>
            <p className="step-sm mt-2 text-ink-600">{promise.body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
