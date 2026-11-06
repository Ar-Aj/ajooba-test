import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { OrderAddress } from '@ajooba/contracts';
import { HeaderFact, PageHeader, Panel } from '@/components/layout/page-header';
import { Status, orderStatusTone, paymentStatusTone } from '@/components/ui/status';
import { OrderStatusControl } from '@/features/orders/components/order-status-control';
import { OpsApiError, fetchOrder } from '@/lib/ops';
import { dateTime, rupees } from '@/lib/format';
import { mediaUrl } from '@/lib/env';

/**
 * One order.
 *
 * ## Why this page exists at all
 *
 * The list answers "what needs me". This page answers "what exactly did they
 * buy, and where does it go" â€” the two questions a packing bench asks. The
 * address is printed large and un-truncated because someone reads it off a screen
 * and writes it onto a parcel; it is not a detail to be hidden behind a toggle.
 *
 * ## What is frozen and what is live
 *
 * Everything money-shaped and everything name-shaped on this page is a **snapshot
 * taken at checkout**: the item titles, the colour names, the unit prices, the
 * delivery address. A later catalogue rename or price change cannot rewrite it.
 * That is why the values here are read from the order and never joined back to
 * the live catalogue â€” joining would be the bug, not the improvement.
 *
 * ## The status control
 *
 * `OrderStatusControl` offers only the moves the API's transition table permits
 * and shows the server's refusal verbatim if they ever disagree. There is no
 * "force" control, by design.
 */

export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  let order = null;
  let failure: string | null = null;
  let missing = false;

  try {
    order = await fetchOrder(orderId);
  } catch (error) {
    if (error instanceof OpsApiError && error.status === 404) {
      missing = true;
    } else {
      failure = error instanceof OpsApiError ? error.message : 'The order could not be read.';
    }
  }

  if (missing) notFound();

  if (failure || !order) {
    return (
      <>
        <PageHeader
          eyebrow="Sell Â· Orders"
          title="Order"
          description="One order, as it was placed."
        />
        <div className="page-body">
          <div className="sheet p-6" role="alert">
            <p className="step-md font-medium text-ink-900">The order could not be read</p>
            <p className="step-sm mt-1.5 text-ink-600">{failure}</p>
            <Link href="/orders" className="btn btn-secondary mt-5">
              Back to orders
            </Link>
          </div>
        </div>
      </>
    );
  }

  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <>
      <PageHeader
        eyebrow="Sell Â· Orders"
        title={order.orderNumber}
        description={`Placed ${dateTime(order.placedAt)} by ${order.customerName}.`}
        meta={
          <>
            <HeaderFact
              label="Status"
              value={<Status tone={orderStatusTone(order.status)}>{order.status}</Status>}
            />
            <HeaderFact
              label="Payment"
              value={
                <Status tone={paymentStatusTone(order.paymentStatus)}>
                  {order.paymentStatus.replace(/_/g, ' ')}
                </Status>
              }
            />
            <HeaderFact label="Items" value={units} />
            <HeaderFact label="Total" value={rupees(order.totalAmount)} />
          </>
        }
        actions={
          <Link href="/orders" className="btn btn-secondary btn-sm">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            All orders
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 px-4 py-6 md:px-8 lg:grid-cols-3">
        {/* ---- the lines ------------------------------------------------ */}
        <div className="space-y-6 lg:col-span-2">
          <Panel
            title="Items"
            description="Frozen at checkout â€” a later catalogue change cannot rewrite this."
            flush
          >
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Design</th>
                    <th scope="col">Colour / size</th>
                    <th scope="col" className="text-right">
                      Unit
                    </th>
                    <th scope="col" className="text-center">
                      Qty
                    </th>
                    <th scope="col" className="text-right">
                      Line
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={`${item.variantId}-${item.sku}`}>
                      <td>
                        <span className="flex items-center gap-3">
                          {item.imageUrl ? (
                            /*
                             * A plain <img>, not next/image: the media origin is
                             * configured per environment and is not in the
                             * panel's `images.remotePatterns`; adding a remote
                             * pattern for a local path would be worse than one
                             * unoptimised thumbnail. Sized explicitly so it
                             * cannot shift the row.
                             */
                            <img
                              src={mediaUrl(item.imageUrl)}
                              alt=""
                              width={32}
                              height={32}
                              loading="lazy"
                              className="h-8 w-8 shrink-0 bg-cream-100 object-cover"
                            />
                          ) : (
                            <span className="h-8 w-8 shrink-0 bg-panel-200" aria-hidden="true" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate text-ink-900">{item.title}</span>
                            <span className="block font-mono text-[0.6875rem] text-ink-400">
                              {item.sku}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-ink-600">
                        {item.colour} Â· UK {item.size}
                      </td>
                      <td className="text-right tabular-nums text-ink-700">
                        {rupees(item.unitPrice)}
                      </td>
                      <td className="text-center tabular-nums text-ink-700">{item.quantity}</td>
                      <td className="text-right tabular-nums font-medium text-ink-900">
                        {rupees(item.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="border-t border-border p-4">
              <Line label="Subtotal" value={rupees(order.subtotal)} />
              {order.discountAmount > 0 ? (
                <Line
                  label={`Discount${order.couponCode ? ` (${order.couponCode})` : ''}`}
                  value={`âˆ’ ${rupees(order.discountAmount)}`}
                />
              ) : null}
              <Line
                label="Shipping"
                value={order.shippingFee === 0 ? 'Free' : rupees(order.shippingFee)}
              />
              <Line label="Tax" value={rupees(order.taxAmount)} />
              <div className="mt-2 flex items-baseline justify-between border-t border-border-strong pt-2">
                <dt className="step-sm font-medium text-ink-900">Total charged</dt>
                <dd className="step-md font-medium tabular-nums text-ink-900">
                  {rupees(order.totalAmount)}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Status" description="Only the moves the API will accept are offered.">
            <OrderStatusControl
              orderId={order.id}
              current={order.status}
              orderNumber={order.orderNumber}
            />
          </Panel>
        </div>

        {/* ---- the facts ------------------------------------------------ */}
        <div className="space-y-6">
          <Panel title="Deliver to" description="Exactly as the customer entered it.">
            <AddressBlock address={order.shippingAddress} phone={order.customerPhone} />
            {order.billingAddress.line1 !== order.shippingAddress.line1 ||
            order.billingAddress.postalCode !== order.shippingAddress.postalCode ? (
              <div className="mt-4 border-t border-border pt-4">
                <p className="label-cap text-ink-400">Billing address differs</p>
                <div className="mt-1.5">
                  <AddressBlock address={order.billingAddress} phone={order.customerPhone} />
                </div>
              </div>
            ) : null}
          </Panel>

          <Panel title="Payment">
            <dl className="space-y-2">
              <Fact
                label="Method"
                value={order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Razorpay'}
              />
              <Fact
                label="Status"
                value={
                  <Status tone={paymentStatusTone(order.paymentStatus)}>
                    {order.paymentStatus.replace(/_/g, ' ')}
                  </Status>
                }
              />
              <Fact label="Reference" value={order.paymentRef ?? 'â€”'} mono />
              <Fact label="Placed" value={dateTime(order.placedAt)} />
              {order.deliveredAt ? (
                <Fact label="Delivered" value={dateTime(order.deliveredAt)} />
              ) : null}
              {order.cancelledAt ? (
                <Fact label="Cancelled" value={dateTime(order.cancelledAt)} />
              ) : null}
            </dl>
          </Panel>

          <Panel title="Customer">
            <p className="step-sm text-ink-900">{order.customerName}</p>
            <p className="step-sm text-ink-600">{order.customerEmail}</p>
            <p className="step-sm text-ink-600">{order.customerPhone}</p>
          </Panel>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <dt className="step-sm text-ink-600">{label}</dt>
      <dd className="step-sm tabular-nums text-ink-800">{value}</dd>
    </div>
  );
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="step-sm shrink-0 text-ink-500">{label}</dt>
      <dd
        className={`text-right text-[0.8125rem] text-ink-900 ${mono ? 'font-mono text-[0.75rem]' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * A postal address, laid out the way it is written on an envelope.
 *
 * Deliberately not comma-joined: a packer copies line by line, and a single
 * wrapped sentence makes it easy to skip the second line.
 */
function AddressBlock({ address, phone }: { address: OrderAddress; phone: string }) {
  return (
    <address className="step-sm not-italic leading-relaxed text-ink-800">
      <span className="block font-medium text-ink-900">{address.fullName}</span>
      <span className="block">{address.line1}</span>
      {address.line2 ? <span className="block">{address.line2}</span> : null}
      <span className="block">
        {address.city}, {address.state} {address.postalCode}
      </span>
      <span className="block">{address.country}</span>
      <span className="mt-1.5 block tabular-nums text-ink-600">{phone}</span>
    </address>
  );
}
