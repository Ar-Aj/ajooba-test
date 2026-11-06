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
            <SpecRow label="Material" value="Leather / suede — see the description" />
            <SpecRow label="Care" value="Wipe dry. Never machine wash." />
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
                        Orders placed before 2 PM IST are dispatched the same working day. Metro
                        cities typically receive parcels in 2–4 working days; the rest of India in
                        4–7.
                      </p>
                      <p>
                        Shipping is free on orders above ₹1,499. Below that a flat courier fee is
                        applied and shown before you pay.
                      </p>
                      <p>Cash on delivery is available on orders up to ₹10,000.</p>
                    </div>
                  ),
                },
                {
                  id: 'returns',
                  title: 'Returns & exchanges',
                  content: (
                    <div className="space-y-2">
                      <p>
                        Return or exchange any unused pair within 10 days of delivery. A prepaid
                        reverse pickup label is included in every box.
                      </p>
                      <p>
                        Start a return from your account, or write to us and we will arrange the
                        pickup. Refunds are issued to the original payment method once the item is
                        checked.
                      </p>
                      <p>
                        A size exchange is treated as a return plus a new order, so the new pair
                        ships once the return is collected.
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
                        Wipe with a dry cloth after every wear. For leather, use a conditioner once
                        a month — never machine wash.
                      </p>
                      <p>
                        Store on the shelf, not the floor, and keep them out of damp. A pair that is
                        dried properly lasts for years.
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
                        Sizes shown are UK/India. Our lasts run true to size, with a slightly wider
                        toe box than most European brands. If you are between sizes or have a wide
                        foot, we recommend going up half a size.
                      </p>
                      <p>
                        Not sure? Order two sizes, wear one indoors, and return the other — we cover
                        the reverse pickup.
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
