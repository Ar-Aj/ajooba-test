'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  Order,
  OrderStatus,
  PaymentIntent,
  PaymentVerificationResult,
} from '@ajooba/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-states';
import { useToast } from '@/components/ui/toast';
import { customerApiRequest } from '@/lib/customer-session';
import { loadRazorpayCheckout } from '@/lib/razorpay-client';
import { rupees } from '@/lib/format';

const STATUS_TONE: Record<OrderStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'gold'> = {
  placed: 'neutral',
  processing: 'gold',
  shipped: 'gold',
  completed: 'success',
  cancelled: 'danger',
};

const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'Placed',
  processing: 'Processing',
  shipped: 'Shipped',
  completed: 'Delivered',
  cancelled: 'Cancelled',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge intent={STATUS_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}

export function OrderListClient() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await customerApiRequest<{ items: Order[] }>('/v1/orders?page=1&pageSize=100');
      setOrders(result.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not load your orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  async function retryPayment(order: Order) {
    setBusyOrderId(order.id);
    try {
      const ready = await loadRazorpayCheckout();
      if (!ready || !window.Razorpay) {
        throw new Error('The secure payment window could not load. Please try again.');
      }

      const intent = await customerApiRequest<PaymentIntent>(`/v1/payments/${order.id}/intent`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const checkout = new window.Razorpay({
        key: intent.keyId,
        amount: intent.amount,
        currency: intent.currency,
        name: 'Ajooba Footwear',
        description: `Order ${order.orderNumber}`,
        order_id: intent.razorpayOrderId,
        prefill: {
          name: intent.customerName,
          email: intent.customerEmail,
          contact: intent.customerPhone,
        },
        theme: { color: '#8b6b3e' },
        handler: async (response) => {
          try {
            const result = await customerApiRequest<PaymentVerificationResult>(
              `/v1/payments/${order.id}/verify`,
              { method: 'POST', body: JSON.stringify(response) },
            );
            if (!result.verified) {
              toast({
                title: 'Payment is not confirmed',
                description: result.reason ?? 'Your order is still unpaid. Retry when ready.',
                tone: 'warning',
              });
              return;
            }
            toast({ title: 'Payment verified', description: order.orderNumber, tone: 'success' });
            await loadOrders();
          } catch (cause) {
            toast({
              title: 'Could not verify payment',
              description:
                cause instanceof Error
                  ? `${cause.message} Your order remains saved for retry.`
                  : 'Your order remains saved for retry.',
              tone: 'warning',
            });
          }
        },
        modal: {
          ondismiss: () => {
            toast({
              title: 'Payment not completed',
              description: 'Your order is still unpaid. You can retry from this page.',
              tone: 'warning',
            });
          },
        },
      });
      checkout.on('payment.failed', (response) => {
        toast({
          title: 'Payment failed',
          description: response.error?.description ?? 'Please retry or choose another method.',
          tone: 'warning',
        });
      });
      checkout.open();
    } catch (cause) {
      toast({
        title: 'Could not restart payment',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        tone: 'warning',
      });
    } finally {
      setBusyOrderId(null);
    }
  }

  if (loading) {
    return (
      <p className="step-sm text-ink-500" role="status" aria-live="polite">
        Loading your orders…
      </p>
    );
  }

  if (error) {
    return (
      <div className="space-y-4" role="alert">
        <p className="step-sm text-claret-700">{error}</p>
        <div className="flex flex-wrap gap-3">
          <Button intent="outline" onClick={() => void loadOrders()}>
            Try again
          </Button>
          <Button intent="ghost" asChild>
            <Link href="/login?next=%2Faccount%2Forders">Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        title="No orders yet"
        description="Orders placed through this account will appear here with their current payment and delivery status."
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
                <p className="font-medium text-ink-900">{order.orderNumber}</p>
                <OrderStatusBadge status={order.status} />
                <Badge intent={order.paymentStatus === 'paid' ? 'success' : 'warning'}>
                  {order.paymentStatus === 'paid'
                    ? 'Paid'
                    : order.paymentMethod === 'cod'
                      ? 'Due on delivery'
                      : 'Payment pending'}
                </Badge>
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
            <p className="font-display text-lg text-ink-900">{rupees(order.totalAmount)}</p>
          </div>

          <ul className="mt-3 flex flex-wrap gap-2">
            {order.items.map((line) => (
              <li
                key={line.variantId}
                className="flex items-center gap-2 rounded-lg border border-ink-100 bg-cream-50 px-2 py-1.5"
              >
                <span className="h-8 w-8 overflow-hidden rounded bg-ink-50">
                  {line.imageUrl ? (
                    <img src={line.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </span>
                <span className="text-xs text-ink-700">
                  {line.title} · UK {line.size} · ×{line.quantity}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
            <Button intent="outline" size="sm" asChild>
              <Link href={`/account/orders/${encodeURIComponent(order.orderNumber)}`}>
                View details
              </Link>
            </Button>
            {order.paymentMethod === 'razorpay' && order.paymentStatus !== 'paid' ? (
              <Button
                intent="gold"
                size="sm"
                disabled={busyOrderId === order.id}
                onClick={() => void retryPayment(order)}
              >
                {busyOrderId === order.id ? 'Connecting…' : 'Complete payment'}
              </Button>
            ) : null}
            {order.status === 'completed' ? (
              <>
                <Button intent="ghost" size="sm" asChild>
                  <Link href={`/account/returns?order=${encodeURIComponent(order.orderNumber)}`}>
                    Request a return
                  </Link>
                </Button>
                <Button intent="ghost" size="sm" asChild>
                  <Link href={`/account/exchanges?order=${encodeURIComponent(order.id)}`}>
                    Request a size exchange
                  </Link>
                </Button>
              </>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
