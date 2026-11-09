'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Order, OrderItem, ReturnReason, ReturnRequest } from '@ajooba/contracts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-states';
import { Field, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { customerApiRequest, customerSession } from '@/lib/customer-session';
import { rupees } from '@/lib/format';

interface PageResult<T> {
  items: T[];
}

const RETURN_REASONS: readonly { value: ReturnReason; label: string }[] = [
  { value: 'size-too-small', label: 'Size too small' },
  { value: 'size-too-large', label: 'Size too large' },
  { value: 'not-as-described', label: 'Not as described' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'wrong-item', label: 'Wrong item' },
  { value: 'changed-mind', label: 'Changed my mind' },
  { value: 'other', label: 'Other' },
];

const RETURN_STATUS_LABEL: Record<ReturnRequest['status'], string> = {
  requested: 'Awaiting review',
  approved: 'Approved · awaiting return instructions from our team',
  rejected: 'Not approved',
  received: 'Pair received · inspection complete',
  refunded: 'Refund confirmed',
};

function withinReturnWindow(order: Order): boolean {
  if (order.status !== 'completed' || !order.deliveredAt) return false;
  return Date.now() <= new Date(order.deliveredAt).getTime() + 10 * 24 * 60 * 60 * 1000;
}

export function ReturnsClient({ requestedOrder }: { requestedOrder?: string }) {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [orderId, setOrderId] = useState('');
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason>('size-too-small');
  const [reasonNote, setReasonNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!customerSession.read()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    Promise.all([
      customerApiRequest<PageResult<Order>>('/v1/orders?page=1&pageSize=100'),
      customerApiRequest<PageResult<ReturnRequest>>('/v1/returns?page=1&pageSize=100'),
    ])
      .then(([ordersResult, returnsResult]) => {
        if (cancelled) return;
        setOrders(ordersResult.items);
        setReturns(returnsResult.items);
        const eligible = ordersResult.items.filter(withinReturnWindow);
        const preferred = eligible.find(
          (order) => order.id === requestedOrder || order.orderNumber === requestedOrder,
        );
        setOrderId((preferred ?? eligible[0])?.id ?? '');
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'We could not load your returns.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [requestedOrder]);

  const selectedOrder = orders.find((order) => order.id === orderId);
  const returnedQuantity = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const request of returns) {
      if (request.status === 'rejected') continue;
      for (const item of request.items) {
        quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
      }
    }
    return quantities;
  }, [returns]);

  const availableItems = useMemo(
    () =>
      (selectedOrder?.items ?? [])
        .map((item) => ({
          item,
          remaining: item.quantity - (returnedQuantity.get(item.variantId) ?? 0),
        }))
        .filter((line) => line.remaining > 0),
    [returnedQuantity, selectedOrder],
  );

  const eligibleOrders = orders.filter(withinReturnWindow);
  const canSubmit = Boolean(
    selectedOrder &&
    withinReturnWindow(selectedOrder) &&
    Object.keys(selectedItems).length > 0 &&
    !submitting,
  );

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrder || !canSubmit) return;
    setSubmitting(true);
    setError('');

    try {
      const created = await customerApiRequest<ReturnRequest>('/v1/returns', {
        method: 'POST',
        body: JSON.stringify({
          orderId: selectedOrder.id,
          items: Object.entries(selectedItems).map(([variantId, quantity]) => ({
            variantId,
            quantity,
          })),
          reason,
          reasonNote: reasonNote.trim(),
        }),
      });
      setReturns((current) => [created, ...current]);
      setSelectedItems({});
      setReasonNote('');
      toast({
        title: 'Return request received',
        description: created.returnNumber,
        tone: 'success',
      });
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'We could not submit the return request.';
      setError(message);
      toast({ title: 'Return request not submitted', description: message, tone: 'warning' });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading)
    return (
      <p className="step-sm text-ink-500" role="status">
        Loading your orders…
      </p>
    );

  if (!customerSession.read()) {
    return (
      <EmptyState
        title="Sign in to request a return"
        description="Your order and delivery date are checked against your account."
        action={
          <Button intent="gold" asChild>
            <Link href="/login?next=%2Faccount%2Freturns">Sign in</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-10">
      {error && orders.length === 0 ? (
        <p role="alert" className="step-sm text-claret-700">
          {error}
        </p>
      ) : null}

      {eligibleOrders.length === 0 ? (
        <EmptyState
          title="No orders in the return window"
          description="A return request can be made within 10 days after delivery."
          action={
            <Button intent="outline" asChild>
              <Link href="/account/orders">View orders</Link>
            </Button>
          }
        />
      ) : (
        <form onSubmit={submitRequest} className="space-y-5 border-t border-border pt-5">
          <h2 className="font-display text-xl text-ink-900">Request a return</h2>
          <p className="step-xs max-w-2xl text-ink-500">
            Our team reviews the request and confirms return or pickup instructions before you send
            the pair. Refund status is updated only after the payment provider confirms it.
          </p>

          <Field label="Delivered order" htmlFor="return-order">
            <select
              id="return-order"
              value={orderId}
              onChange={(event) => {
                setOrderId(event.target.value);
                setSelectedItems({});
              }}
              className="w-full border border-border bg-white px-3 py-3 text-sm text-ink-900"
              required
            >
              {eligibleOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNumber} · delivered{' '}
                  {new Date(order.deliveredAt!).toLocaleDateString('en-IN')}
                </option>
              ))}
            </select>
          </Field>

          {selectedOrder ? (
            <fieldset className="space-y-2">
              <legend className="label-cap mb-2 text-ink-500">Choose items to return</legend>
              {availableItems.length === 0 ? (
                <p className="step-sm text-ink-500">
                  All items on this order already have a return request.
                </p>
              ) : (
                availableItems.map(({ item, remaining }) => (
                  <ReturnLine
                    key={item.variantId}
                    item={item}
                    remaining={remaining}
                    quantity={selectedItems[item.variantId] ?? 0}
                    onChange={(quantity) =>
                      setSelectedItems((current) => {
                        const next = { ...current };
                        if (quantity <= 0) delete next[item.variantId];
                        else next[item.variantId] = quantity;
                        return next;
                      })
                    }
                  />
                ))
              )}
            </fieldset>
          ) : null}

          <Field label="Reason" htmlFor="return-reason">
            <select
              id="return-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value as ReturnReason)}
              className="w-full border border-border bg-white px-3 py-3 text-sm text-ink-900"
            >
              {RETURN_REASONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Additional details (optional)" htmlFor="return-note">
            <Textarea
              id="return-note"
              value={reasonNote}
              onChange={(event) => setReasonNote(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Tell us anything that will help us review your request."
            />
          </Field>

          {error ? (
            <p role="alert" className="step-sm text-claret-700">
              {error}
            </p>
          ) : null}
          <Button intent="gold" type="submit" disabled={!canSubmit}>
            {submitting ? 'Submitting…' : 'Submit return request'}
          </Button>
        </form>
      )}

      <section className="border-t border-border pt-6">
        <h2 className="font-display text-xl text-ink-900">Return activity</h2>
        {returns.length === 0 ? (
          <p className="step-sm mt-3 text-ink-500">No return requests yet.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {returns.map((request) => (
              <li key={request.id} className="border-l-2 border-gold-500 pl-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="step-sm font-medium text-ink-900">{request.returnNumber}</p>
                  <span className="step-xs text-ink-600">
                    {RETURN_STATUS_LABEL[request.status]}
                  </span>
                </div>
                <p className="step-xs mt-1 text-ink-500">
                  {request.orderNumber} · {request.items.length} item(s) ·{' '}
                  {rupees(request.refundAmount)}
                </p>
                {request.resolutionNote ? (
                  <p className="step-xs mt-1 text-ink-600">Shop update: {request.resolutionNote}</p>
                ) : null}
                <p className="step-xs mt-1 text-ink-400">
                  Requested {new Date(request.requestedAt).toLocaleDateString('en-IN')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReturnLine({
  item,
  remaining,
  quantity,
  onChange,
}: {
  item: OrderItem;
  remaining: number;
  quantity: number;
  onChange: (quantity: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
      <label className="flex min-w-0 items-start gap-3">
        <input
          type="checkbox"
          checked={quantity > 0}
          onChange={(event) => onChange(event.target.checked ? 1 : 0)}
          className="mt-1 accent-ink-900"
        />
        <span>
          <span className="block step-sm text-ink-900">{item.title}</span>
          <span className="mt-0.5 block step-xs text-ink-500">
            {item.colour} · UK {item.size} · {rupees(item.unitPrice)} each · up to {remaining}
          </span>
        </span>
      </label>
      {quantity > 0 ? (
        <label className="step-xs flex items-center gap-2 text-ink-600">
          Quantity
          <input
            type="number"
            min={1}
            max={remaining}
            value={quantity}
            onChange={(event) =>
              onChange(Math.min(remaining, Math.max(1, Number(event.target.value) || 1)))
            }
            className="w-16 border border-border bg-white px-2 py-2 text-center text-sm text-ink-900"
          />
        </label>
      ) : null}
    </div>
  );
}
