'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { Order } from '@ajooba/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-states';
import { customerApiRequest } from '@/lib/customer-session';
import { rupees } from '@/lib/format';
import { OrderStatusBadge } from './order-list-client';
import { cn } from '@/lib/cn';

const TIMELINE = [
  { key: 'placed', title: 'Order placed', body: 'We have received your order.' },
  { key: 'processing', title: 'Processing', body: 'Your order is being prepared for dispatch.' },
  { key: 'shipped', title: 'Shipped', body: 'Your parcel is with the courier.' },
  { key: 'completed', title: 'Delivered', body: 'Your parcel has been delivered.' },
] as const;

export function OrderDetailClient() {
  const params = useParams<{ id: string }>();
  const orderNumber = decodeURIComponent(String(params.id ?? ''));
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    customerApiRequest<Order>(`/v1/orders/${encodeURIComponent(orderNumber)}`)
      .then((result) => {
        if (!cancelled) setOrder(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'We could not load this order.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orderNumber]);

  if (loading) {
    return (
      <p className="step-sm text-ink-500" role="status" aria-live="polite">
        Loading order details…
      </p>
    );
  }

  if (error || !order) {
    return (
      <EmptyState
        title={error ? 'We could not load that order' : "We can't find that order"}
        description={
          error ?? 'The reference may be mistyped, or it may belong to a different account.'
        }
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
      <section className="rounded-2xl border border-ink-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-display text-xl">{order.orderNumber}</p>
            <p className="mt-1 text-xs text-ink-500">
              Placed{' '}
              {new Date(order.placedAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <OrderStatusBadge status={order.status} />
            <Badge intent={order.paymentStatus === 'paid' ? 'success' : 'warning'}>
              {order.paymentStatus === 'paid'
                ? 'Paid'
                : order.paymentMethod === 'cod'
                  ? 'Due on delivery'
                  : 'Payment pending'}
            </Badge>
          </div>
        </div>

        {order.status !== 'cancelled' ? (
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
                          ? 'border-gold-600 bg-gold-600 text-ink-950'
                          : 'border-ink-200 bg-white text-ink-300',
                        current && 'ring-4 ring-gold-600/15',
                      )}
                    >
                      {done ? '✓' : index + 1}
                    </span>
                    {index < TIMELINE.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'w-0.5 flex-1',
                          index < activeIndex ? 'bg-gold-600' : 'bg-ink-200',
                        )}
                        style={{ minHeight: '2rem' }}
                      />
                    ) : null}
                  </div>
                  <div className={cn('pb-6', index === TIMELINE.length - 1 && 'pb-0')}>
                    <p
                      className={cn('text-sm font-medium', done ? 'text-ink-900' : 'text-ink-400')}
                    >
                      {stage.title}
                      {current ? (
                        <span className="ml-2 text-xs font-normal text-gold-700">
                          Current stage
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">{stage.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-5 step-sm text-claret-700">This order was cancelled.</p>
        )}
      </section>

      <section className="rounded-2xl border border-ink-200 bg-white p-5">
        <h2 className="font-display text-lg">Items</h2>
        <ul className="mt-3 space-y-3">
          {order.items.map((line) => (
            <li key={line.variantId} className="flex gap-3">
              <span className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-ink-50">
                {line.imageUrl ? (
                  <img src={line.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium text-ink-900">{line.title}</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {line.colour} · UK {line.size} · Qty {line.quantity}
                </p>
              </div>
              <p className="text-sm font-medium text-ink-900">{rupees(line.lineTotal)}</p>
            </li>
          ))}
        </ul>

        <dl className="mt-5 space-y-2 border-t border-ink-100 pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-600">Subtotal</dt>
            <dd>{rupees(order.subtotal)}</dd>
          </div>
          {order.discountAmount > 0 ? (
            <div className="flex justify-between">
              <dt className="text-ink-600">Discount</dt>
              <dd className="text-claret-700">−{rupees(order.discountAmount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-ink-600">Shipping</dt>
            <dd>{order.shippingFee === 0 ? 'Free' : rupees(order.shippingFee)}</dd>
          </div>
          {order.taxAmount > 0 ? (
            <div className="flex justify-between">
              <dt className="text-ink-600">Tax</dt>
              <dd>{rupees(order.taxAmount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-ink-100 pt-3 text-base font-medium">
            <dt>Total</dt>
            <dd>{rupees(order.totalAmount)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-ink-200 bg-white p-5">
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
      </section>

      <div className="flex flex-wrap gap-3">
        <Button intent="outline" asChild>
          <Link href="/account/orders">All orders</Link>
        </Button>
        {order.status === 'completed' ? (
          <>
            <Button intent="ghost" asChild>
              <Link href={`/account/returns?order=${encodeURIComponent(order.orderNumber)}`}>
                Request a return
              </Link>
            </Button>
            <Button intent="ghost" asChild>
              <Link href={`/account/exchanges?order=${encodeURIComponent(order.id)}`}>
                Request a size exchange
              </Link>
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
