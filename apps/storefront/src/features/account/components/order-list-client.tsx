'use client';

import Link from 'next/link';
import { useCommerce } from '@/lib/commerce-context';
import { EmptyState } from '@/components/ui/empty-states';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { rupees } from '@/lib/format';
import type { LocalOrder, OrderStatus } from '@/lib/commerce-types';

const STATUS_TONE: Record<OrderStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'gold'> = {
  placed: 'neutral',
  confirmed: 'gold',
  shipped: 'gold',
  delivered: 'success',
  cancelled: 'danger',
  returned: 'warning',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'Placed',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge intent={STATUS_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}

export function OrderListClient() {
  const { orders } = useCommerce();

  if (orders.length === 0) {
    return (
      <EmptyState
        title="No orders yet"
        description="Once you place an order it will appear here with its status and tracking timeline."
        action={
          <Button intent="gold" asChild>
            <Link href="/products">Start shopping</Link>
          </Button>
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {orders.map((order) => (
        <li key={order.id} className="rounded-2xl border border-ink-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-ink-900">{order.number}</p>
                <OrderStatusBadge status={order.status} />
              </div>
              <p className="mt-1 text-xs text-ink-500">
                Placed{' '}
                {new Date(order.placedAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            </div>
            <p className="font-display text-lg text-ink-900">{rupees(order.total)}</p>
          </div>

          <ul className="mt-3 flex flex-wrap gap-2">
            {order.lines.map((line) => (
              <li
                key={line.variantSku}
                className="flex items-center gap-2 rounded-lg border border-ink-100 bg-cream-50 px-2 py-1.5"
              >
                <span className="h-8 w-8 overflow-hidden rounded bg-ink-50">
                  {line.imageUrl ? (
                    <img src={line.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </span>
                <span className="text-xs text-ink-700">
                  {line.productTitle} · UK {line.size} · ×{line.quantity}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
            <Button intent="outline" size="sm" asChild>
              <Link href={`/account/orders/${encodeURIComponent(order.number)}`}>View details</Link>
            </Button>
            <Button intent="ghost" size="sm" asChild>
              <Link href={`/account/returns?order=${encodeURIComponent(order.number)}`}>
                Request a return
              </Link>
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export { type LocalOrder };
