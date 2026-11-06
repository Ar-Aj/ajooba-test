'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-states';
import { useCommerce } from '@/lib/commerce-context';
import { rupees } from '@/lib/format';
import { OrderStatusBadge } from './order-list-client';
import { cn } from '@/lib/cn';

/**
 * The tracking timeline.
 *
 * The stages are the ones a real courier pipeline goes through. Only the
 * stages up to and including the order's current status are marked done —
 * nothing is optimistically marked "shipped" before it actually is.
 */
const TIMELINE = [
  {
    key: 'placed',
    title: 'Order placed',
    body: 'We have received your order and sent you a confirmation.',
  },
  {
    key: 'confirmed',
    title: 'Confirmed',
    body: 'Your order has been packed and is awaiting pickup.',
  },
  {
    key: 'shipped',
    title: 'Shipped',
    body: 'Your parcel is on its way with the courier.',
  },
  {
    key: 'delivered',
    title: 'Delivered',
    body: 'Your parcel has been delivered.',
  },
] as const;

export function OrderDetailClient() {
  const params = useParams<{ id: string }>();
  const orderNumber = decodeURIComponent(String(params.id ?? ''));
  const { orders } = useCommerce();
  const order = orders.find((o) => o.number === orderNumber);

  if (!order) {
    return (
      <EmptyState
        title="We can't find that order"
        description="It may have been placed on a different device, or the reference is mistyped. Orders placed on this device are always listed under your account."
        action={
          <Button intent="gold" asChild>
            <Link href="/account/orders">See all orders</Link>
          </Button>
        }
      />
    );
  }

  const currentIndex = TIMELINE.findIndex((stage) => stage.key === order.status);
  const activeIndex = currentIndex === -1 ? 0 : currentIndex;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ink-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-display text-xl">{order.number}</p>
            <p className="mt-1 text-xs text-ink-500">
              Placed{' '}
              {new Date(order.placedAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>

        <ol className="mt-6 space-y-0" aria-label="Order tracking">
          {TIMELINE.map((stage, index) => {
            const done = index <= activeIndex;
            const current = index === activeIndex;
            return (
              <li key={stage.key} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11px] font-semibold',
                      done
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-ink-200 bg-white text-ink-300',
                      current && 'ring-4 ring-emerald-600/15',
                    )}
                  >
                    {done ? '✓' : index + 1}
                  </span>
                  {index < TIMELINE.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'w-0.5 flex-1',
                        index < activeIndex ? 'bg-emerald-600' : 'bg-ink-200',
                      )}
                      style={{ minHeight: '2rem' }}
                    />
                  ) : null}
                </div>
                <div className={cn('pb-6', index === TIMELINE.length - 1 && 'pb-0')}>
                  <p className={cn('text-sm font-medium', done ? 'text-ink-900' : 'text-ink-400')}>
                    {stage.title}
                    {current ? (
                      <span className="ml-2 text-xs font-normal text-emerald-700">
                        — current stage
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">{stage.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="rounded-2xl border border-ink-200 bg-white p-5">
        <h2 className="font-display text-lg">Items</h2>
        <ul className="mt-3 space-y-3">
          {order.lines.map((line) => (
            <li key={line.variantSku} className="flex gap-3">
              <Link
                href={`/products/${line.productSlug}`}
                className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-ink-50"
                tabIndex={-1}
                aria-hidden="true"
              >
                {line.imageUrl ? (
                  <img src={line.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/products/${line.productSlug}`}
                  className="line-clamp-2 text-sm font-medium text-ink-900 hover:underline"
                >
                  {line.productTitle}
                </Link>
                <p className="mt-0.5 text-xs text-ink-500">
                  {line.colour} · UK {line.size} · Qty {line.quantity}
                </p>
              </div>
              <p className="text-sm font-medium text-ink-900">
                {rupees(line.unitPrice * line.quantity)}
              </p>
            </li>
          ))}
        </ul>

        <dl className="mt-5 space-y-2 border-t border-ink-100 pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-600">Subtotal</dt>
            <dd>{rupees(order.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-600">Shipping</dt>
            <dd>{order.shipping === 0 ? 'Free' : rupees(order.shipping)}</dd>
          </div>
          <div className="flex justify-between text-base font-medium">
            <dt>Total</dt>
            <dd>{rupees(order.total)}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-2xl border border-ink-200 bg-white p-5">
        <h2 className="font-display text-lg">Delivery address</h2>
        <address className="mt-2 text-sm not-italic leading-relaxed text-ink-600">
          {order.shippingAddress.fullName}
          <br />
          {order.shippingAddress.line1}
          {order.shippingAddress.line2 ? (
            <>
              <br />
              {order.shippingAddress.line2}
            </>
          ) : null}
          <br />
          {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
          {order.shippingAddress.postalCode}
          <br />
          <span className="text-ink-500">{order.shippingAddress.phone}</span>
        </address>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button intent="outline" asChild>
          <Link href="/account/orders">All orders</Link>
        </Button>
        <Button intent="ghost" asChild>
          <Link href={`/account/returns?order=${encodeURIComponent(order.number)}`}>
            Request a return
          </Link>
        </Button>
      </div>
    </div>
  );
}
