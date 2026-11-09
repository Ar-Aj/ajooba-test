import { Reveal } from '@/components/ui/reveal';

/**
 * The three promises, stated plainly.
 *
 * A hairline-separated row on the page ground rather than three bordered cards.
 * Three identical boxes side by side is the most generic arrangement in
 * commerce design; the same information set on the page with a rule between
 * items reads as a shop notice, which is what it is.
 *
 * Keep these notices tied to rules the API and account flows enforce. The
 * shipping charge and final total are calculated from live store settings at
 * checkout, so this band does not advertise a fixed threshold or fee.
 */
const PROMISES = [
  {
    title: 'Same-design size exchange',
    body: 'Request another size of the same colour within 10 days of delivery.',
  },
  {
    title: 'Replacement stock checked',
    body: 'The replacement size must be available and approved before it is held.',
  },
  {
    title: 'Clear totals before payment',
    body: 'Checkout confirms the current delivery charge, applicable tax and final total.',
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
