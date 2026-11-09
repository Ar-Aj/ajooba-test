import type { Product } from '@ajooba/contracts';
import { Accordion } from '@/components/ui/accordion';
import { Reveal } from '@/components/ui/reveal';

/**
 * The lower half of the product page: the specification table and the
 * disclosure sections for shipping, returns and care.
 *
 * Every value here comes from the real product record. Where the catalogue
 * genuinely does not carry a field, we say so ("—") rather than inventing one.
 * Material and care are the only prose here, and they are the house's published
 * policy wording, not per-product claims: the catalogue does not store a
 * composition per design, so the page must not pretend it does.
 *
 * Two columns on a laptop, one on a phone, with a hairline between rows rather
 * than a box around each row.
 */
export function ProductAttributes({ product }: { product: Product }) {
  const sizes = [...new Set(product.variants.map((variant) => variant.size))].sort((a, b) => a - b);
  const availableSizes = [
    ...new Set(
      product.variants.filter((variant) => variant.inStock).map((variant) => variant.size),
    ),
  ].sort((a, b) => a - b);

  return (
    <div className="mt-16 grid grid-cols-1 gap-12 border-t border-border pt-12 lg:grid-cols-2 lg:gap-20">
      <Reveal>
        <section aria-labelledby="specs-heading">
          <h2 id="specs-heading" className="step-lg text-ink-900">
            Specification
          </h2>
          <dl className="mt-5 border-t border-border">
            <SpecRow label="Design code" value={product.code} />
            <SpecRow label="Brand" value={product.brand} />
            <SpecRow label="Category" value={product.subcategory} />
            <SpecRow
              label="Colours available"
              value={product.colours.length > 0 ? product.colours.join(', ') : '—'}
            />
            <SpecRow label="Sizes manufactured" value={sizes.length > 0 ? sizes.join(', ') : '—'} />
            <SpecRow
              label="Sizes in stock"
              value={availableSizes.length > 0 ? availableSizes.join(', ') : 'None right now'}
            />
            <SpecRow label="Material" value="Not listed for this design" />
            <SpecRow label="Care" value="Not listed for this design" />
          </dl>
        </section>
      </Reveal>

      <Reveal delay={100}>
        <section aria-labelledby="policies-heading">
          <h2 id="policies-heading" className="step-lg text-ink-900">
            Shipping &amp; returns
          </h2>
          <div className="mt-5">
            <Accordion
              defaultOpen="shipping"
              items={[
                {
                  id: 'shipping',
                  title: 'Delivery',
                  content: (
                    <div className="space-y-2">
                      <p>
                        Any shipping charge is calculated from the current store settings and shown
                        in your order total before payment.
                      </p>
                      <p>
                        Courier availability and delivery estimates can vary by destination PIN
                        code.
                      </p>
                      <p>
                        Cash on delivery appears at checkout when enabled in store settings and the
                        order total is within the configured limit.
                      </p>
                    </div>
                  ),
                },
                {
                  id: 'returns',
                  title: 'Returns & exchanges',
                  content: (
                    <div className="space-y-2">
                      <p>
                        Request a return within 10 days of delivery. Our team reviews each request
                        and confirms the return or pickup instructions before you send the pair.
                      </p>
                      <p>
                        Refunds are processed after the item is received and checked. The request
                        status changes only after the payment provider confirms a refund.
                      </p>
                      <p>
                        Size exchanges are for the same design and colour in another available size.
                        The replacement is held only after staff approval; a different price needs
                        support review.
                      </p>
                    </div>
                  ),
                },
                {
                  id: 'care',
                  title: 'Care & longevity',
                  content: (
                    <div className="space-y-2">
                      <p>
                        Material and care instructions are not listed separately for this design.
                      </p>
                    </div>
                  ),
                },
                {
                  id: 'fit',
                  title: 'Fit & sizing',
                  content: (
                    <div className="space-y-2">
                      <p>
                        Sizes are shown in UK/India sizing. If a delivered order does not fit, you
                        can request an eligible same-design size exchange from your account within
                        10 days of delivery.
                      </p>
                      <p>
                        Review the return policy before ordering if you are unsure between sizes.
                      </p>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </section>
      </Reveal>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-border py-3">
      <dt className="step-sm text-ink-500">{label}</dt>
      <dd className="step-sm text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
