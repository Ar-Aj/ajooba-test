'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ExchangeOption, ExchangeRequest, Order } from '@ajooba/contracts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-states';
import { Input, Textarea, Field } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { customerApiRequest, customerSession } from '@/lib/customer-session';
import { rupees } from '@/lib/format';

interface PageResult<T> {
  items: T[];
}

function exchangeWindowOpen(order: Order): boolean {
  if (order.status !== 'completed' || !order.deliveredAt) return false;
  return Date.now() <= new Date(order.deliveredAt).getTime() + 10 * 24 * 60 * 60 * 1000;
}

const EXCHANGE_STATUS_LABEL: Record<ExchangeRequest['status'], string> = {
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  received: 'Original pair received',
  'replacement-shipped': 'Replacement shipped',
  completed: 'Completed',
};

export function ExchangesClient() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [requests, setRequests] = useState<ExchangeRequest[]>([]);
  const [orderId, setOrderId] = useState('');
  const [originalVariantId, setOriginalVariantId] = useState('');
  const [options, setOptions] = useState<ExchangeOption[]>([]);
  const [replacementVariantId, setReplacementVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reasonNote, setReasonNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!customerSession.read()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    Promise.all([
      customerApiRequest<PageResult<Order>>('/v1/orders?page=1&pageSize=100'),
      customerApiRequest<PageResult<ExchangeRequest>>('/v1/exchanges?page=1&pageSize=100'),
    ])
      .then(([ordersResult, exchangesResult]) => {
        if (cancelled) return;
        setOrders(ordersResult.items);
        setRequests(exchangesResult.items);
        const queryOrderId = new URLSearchParams(window.location.search).get('order');
        const preferred = ordersResult.items.find(
          (order) =>
            (order.id === queryOrderId || order.orderNumber === queryOrderId) &&
            exchangeWindowOpen(order),
        );
        const firstEligible = ordersResult.items.find(exchangeWindowOpen);
        const nextOrder = preferred ?? firstEligible;
        if (nextOrder) {
          setOrderId(nextOrder.id);
          setOriginalVariantId(nextOrder.items[0]?.variantId ?? '');
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'We could not load exchanges.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === orderId),
    [orders, orderId],
  );
  const originalItem = selectedOrder?.items.find((item) => item.variantId === originalVariantId);
  const replacement = options.find((option) => option.variantId === replacementVariantId);
  const canSubmit = Boolean(
    selectedOrder &&
    originalItem &&
    replacement?.available &&
    exchangeWindowOpen(selectedOrder) &&
    quantity > 0 &&
    quantity <= originalItem.quantity &&
    !submitting,
  );

  useEffect(() => {
    if (!orderId || !originalVariantId) {
      setOptions([]);
      setReplacementVariantId('');
      return;
    }

    let cancelled = false;
    setOptionsLoading(true);
    setOptions([]);
    setReplacementVariantId('');
    const query = new URLSearchParams({ orderId, originalVariantId });
    customerApiRequest<PageResult<ExchangeOption>>(`/v1/exchanges/options?${query.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setOptions(result.items);
        setReplacementVariantId(result.items.find((option) => option.available)?.variantId ?? '');
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'We could not check sizes.');
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, originalVariantId]);

  async function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrder || !originalItem || !replacement || !canSubmit) return;

    setSubmitting(true);
    setError(undefined);
    try {
      const created = await customerApiRequest<ExchangeRequest>('/v1/exchanges', {
        method: 'POST',
        body: JSON.stringify({
          orderId: selectedOrder.id,
          originalVariantId,
          replacementVariantId,
          quantity,
          reasonNote: reasonNote.trim(),
        }),
      });
      setRequests((current) => [created, ...current]);
      setReasonNote('');
      toast({
        title: 'Exchange request sent',
        description: created.exchangeNumber,
        tone: 'success',
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'We could not send this request.';
      setError(message);
      toast({ title: 'Exchange request not sent', description: message, tone: 'warning' });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <p className="step-sm text-ink-500" role="status">
        Loading your exchange options…
      </p>
    );
  }

  if (!customerSession.read()) {
    return (
      <EmptyState
        title="Sign in to request an exchange"
        description="Your order and delivery date are checked against your customer account."
        action={
          <Button intent="gold" asChild>
            <Link href="/login?next=%2Faccount%2Fexchanges">Sign in</Link>
          </Button>
        }
      />
    );
  }

  if (error && orders.length === 0) {
    return (
      <p className="step-sm text-claret-700" role="alert">
        {error}
      </p>
    );
  }

  const eligibleOrders = orders.filter(exchangeWindowOpen);

  return (
    <div className="space-y-8">
      {eligibleOrders.length === 0 ? (
        <EmptyState
          title="No orders in the exchange window"
          description="A size exchange can be requested for the same design and colour within 10 days after delivery."
          action={
            <Button intent="outline" asChild>
              <Link href="/account/orders">View orders</Link>
            </Button>
          }
        />
      ) : (
        <form onSubmit={submitRequest} className="space-y-5 border-t border-border pt-5">
          <Field label="Delivered order" htmlFor="exchange-order">
            <select
              id="exchange-order"
              value={orderId}
              onChange={(event) => {
                const next = orders.find((order) => order.id === event.target.value);
                setOrderId(event.target.value);
                setOriginalVariantId(next?.items[0]?.variantId ?? '');
                setQuantity(1);
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
            <Field label="Item and size to exchange" htmlFor="exchange-item">
              <select
                id="exchange-item"
                value={originalVariantId}
                onChange={(event) => {
                  setOriginalVariantId(event.target.value);
                  setQuantity(1);
                }}
                className="w-full border border-border bg-white px-3 py-3 text-sm text-ink-900"
                required
              >
                {selectedOrder.items.map((item) => (
                  <option key={item.variantId} value={item.variantId}>
                    {item.title} · {item.colour} · UK {item.size} · qty {item.quantity}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-ink-800">
              Choose the replacement size
            </legend>
            {optionsLoading ? (
              <p className="step-sm text-ink-500" role="status">
                Checking available sizes…
              </p>
            ) : options.length === 0 ? (
              <p className="step-sm text-ink-500">
                No other sizes are currently listed for this colour.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {options.map((option) => (
                  <label
                    key={option.variantId}
                    className={`flex min-h-12 min-w-16 cursor-pointer flex-col items-center justify-center border px-3 py-2 text-sm ${
                      !option.available
                        ? 'cursor-not-allowed border-border text-ink-300'
                        : replacementVariantId === option.variantId
                          ? 'border-ink-900 bg-ink-900 text-cream-50'
                          : 'border-border text-ink-800 hover:border-ink-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="replacement-size"
                      value={option.variantId}
                      checked={replacementVariantId === option.variantId}
                      disabled={!option.available}
                      onChange={() => setReplacementVariantId(option.variantId)}
                      className="sr-only"
                    />
                    <span>UK {option.size}</span>
                    {!option.available ? (
                      <span className="text-[0.65rem]">
                        {option.unavailableReason === 'price-difference'
                          ? 'Price differs'
                          : option.unavailableReason === 'catalogue-review'
                            ? 'Under review'
                            : 'Out of stock'}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {originalItem ? (
            <Field
              label="Quantity"
              htmlFor="exchange-quantity"
              hint={`Up to ${originalItem.quantity} pair(s)`}
            >
              <Input
                id="exchange-quantity"
                type="number"
                min={1}
                max={originalItem.quantity}
                value={quantity}
                onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
              />
            </Field>
          ) : null}

          {replacement && originalItem ? (
            <div className="space-y-1 border-l-2 border-gold-500 pl-4">
              <p className="step-sm text-ink-800">
                Order price: {rupees(originalItem.unitPrice)} · replacement:{' '}
                {rupees(replacement.sellingPrice)} per pair
              </p>
              <p className="step-xs text-ink-600">
                Exchanges keep the price recorded on your order. A size with a different price needs
                support review before it can be requested.
              </p>
            </div>
          ) : null}

          <Field label="Reason or fit notes (optional)" htmlFor="exchange-note">
            <Textarea
              id="exchange-note"
              value={reasonNote}
              onChange={(event) => setReasonNote(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Tell us which size you need and anything we should know."
            />
          </Field>

          {error ? (
            <p className="step-sm text-claret-700" role="alert">
              {error}
            </p>
          ) : null}
          <Button intent="gold" type="submit" disabled={!canSubmit}>
            {submitting ? 'Sending request…' : 'Send exchange request'}
          </Button>
        </form>
      )}

      <section className="border-t border-border pt-5">
        <h3 className="font-display text-lg text-ink-900">Exchange activity</h3>
        {requests.length === 0 ? (
          <p className="step-sm mt-3 text-ink-500">No exchange requests yet.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {requests.map((request) => (
              <li key={request.id} className="border-l-2 border-gold-500 pl-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="step-sm font-medium text-ink-900">{request.exchangeNumber}</p>
                  <span className="step-xs text-ink-600">
                    {EXCHANGE_STATUS_LABEL[request.status]}
                  </span>
                </div>
                <p className="step-xs mt-1 text-ink-500">
                  {request.orderNumber} · UK {request.originalItem.size} to UK{' '}
                  {request.replacementItem.size} · qty {request.replacementItem.quantity}
                </p>
                {request.resolutionNote ? (
                  <p className="step-xs mt-1 text-ink-600">Shop update: {request.resolutionNote}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
