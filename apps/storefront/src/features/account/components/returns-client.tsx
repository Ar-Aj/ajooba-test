'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Select, Textarea, Field } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-states';
import { useToast } from '@/components/ui/toast';
import { useCommerce } from '@/lib/commerce-context';
import { returnStore, RETURN_REASONS } from '@/lib/return-store';
import type { ReturnRequest } from '@/lib/commerce-types';
import { cn } from '@/lib/cn';

const RETURN_STATUS_LABEL: Record<ReturnRequest['status'], string> = {
  submitted: 'Submitted',
  'in-review': 'Under review',
  'pickup-scheduled': 'Pickup scheduled',
  refunded: 'Refunded',
  rejected: 'Not accepted',
};

const RETURN_STATUS_TONE: Record<
  ReturnRequest['status'],
  'neutral' | 'success' | 'warning' | 'danger' | 'gold'
> = {
  submitted: 'neutral',
  'in-review': 'gold',
  'pickup-scheduled': 'gold',
  refunded: 'success',
  rejected: 'danger',
};

export function ReturnsClient({ requestedOrder }: { requestedOrder?: string }) {
  const { orders, returns } = useCommerce();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [orderNumber, setOrderNumber] = useState(requestedOrder ?? '');
  const [reason, setReason] = useState<ReturnRequest['reason']>('size-issue');
  const [description, setDescription] = useState('');
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);

  const order = useMemo(() => orders.find((o) => o.number === orderNumber), [orders, orderNumber]);

  function submit() {
    const next: Record<string, string> = {};
    if (!order) {
      next.order = 'Choose an order to return items from.';
    }
    if (selectedSkus.length === 0) {
      next.items = 'Select at least one item to return.';
    }
    if (description.trim().length < 10) {
      next.description = 'Please describe the issue in at least 10 characters so we can help.';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    startTransition(() => {
      const created = returnStore.submit({
        orderNumber: order!.number,
        reason,
        description: description.trim(),
        lineSkus: selectedSkus,
      });
      toast({
        title: 'Return request submitted',
        description: `Reference ${created.id}`,
        tone: 'success',
      });
      setOrderNumber('');
      setSelectedSkus([]);
      setDescription('');
      setShowForm(false);
    });
  }

  const returnCount = returns.length;

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl">Return requests</h2>
          <Button
            intent="primary"
            size="sm"
            onClick={() => setShowForm((v) => !v)}
            aria-expanded={showForm}
          >
            {showForm ? 'Cancel' : 'New return request'}
          </Button>
        </div>

        {returnCount === 0 ? (
          <EmptyState
            title="No return requests"
            description="If a pair doesn't fit, submit a return within 10 days of delivery and we'll arrange a free reverse pickup."
            action={
              <Button intent="gold" onClick={() => setShowForm(true)}>
                Start a return
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {returns.map((item) => (
              <li key={item.id} className="rounded-2xl border border-ink-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink-900">{item.id}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      Order {item.orderNumber} ·{' '}
                      {new Date(item.submittedAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <Badge intent={RETURN_STATUS_TONE[item.status]}>
                    {RETURN_STATUS_LABEL[item.status]}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-ink-600">{item.description}</p>
                <p className="mt-2 text-xs text-ink-500">
                  Reason: {RETURN_REASONS.find((r) => r.id === item.reason)?.label ?? item.reason} ·{' '}
                  {item.lineSkus.length} {item.lineSkus.length === 1 ? 'item' : 'items'}
                </p>
                <div className="mt-3">
                  <ReturnProgress status={item.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showForm ? (
        <section className="rounded-2xl border border-ink-200 bg-white p-5">
          <h3 className="font-display text-lg">Request a return</h3>
          <div className="mt-4 space-y-4">
            <Field
              label="Order"
              htmlFor="return-order"
              error={errors.order}
              hint={orders.length === 0 ? 'You have no orders on this device yet.' : undefined}
            >
              <Select
                id="return-order"
                value={orderNumber}
                onChange={(event) => {
                  setOrderNumber(event.target.value);
                  setSelectedSkus([]);
                }}
                aria-invalid={Boolean(errors.order)}
              >
                <option value="">Select an order</option>
                {orders.map((o) => (
                  <option key={o.number} value={o.number}>
                    {o.number} — {new Date(o.placedAt).toLocaleDateString('en-IN')}
                  </option>
                ))}
              </Select>
            </Field>

            {order ? (
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink-800">Which items?</legend>
                <div className="space-y-1">
                  {order.lines.map((line) => {
                    const checked = selectedSkus.includes(line.variantSku);
                    return (
                      <label
                        key={line.variantSku}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-ink-50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setSelectedSkus((current) =>
                              event.target.checked
                                ? [...current, line.variantSku]
                                : current.filter((sku) => sku !== line.variantSku),
                            )
                          }
                          className="h-4 w-4 accent-ink-900"
                        />
                        <span className="text-sm text-ink-700">
                          {line.productTitle} · UK {line.size} · ×{line.quantity}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {errors.items ? (
                  <p role="alert" className="mt-1 text-xs text-claret-700">
                    {errors.items}
                  </p>
                ) : null}
              </fieldset>
            ) : null}

            <Field label="Reason" htmlFor="return-reason">
              <Select
                id="return-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value as ReturnRequest['reason'])}
              >
                {RETURN_REASONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="What went wrong?" htmlFor="return-description" error={errors.description}>
              <Textarea
                id="return-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Tell us what didn't work — this helps us improve."
                rows={4}
                aria-invalid={Boolean(errors.description)}
              />
            </Field>

            <div className="flex flex-wrap justify-end gap-3">
              <Button intent="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button intent="primary" onClick={submit} disabled={pending}>
                Submit request
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

const RETURN_STAGES: Array<ReturnRequest['status']> = [
  'submitted',
  'in-review',
  'pickup-scheduled',
  'refunded',
];

function ReturnProgress({ status }: { status: ReturnRequest['status'] }) {
  if (status === 'rejected') {
    return (
      <p className="text-xs text-claret-700">
        This request was not accepted. Contact us if you think that’s a mistake — we’ll review it
        again.
      </p>
    );
  }
  const index = RETURN_STAGES.indexOf(status);
  return (
    <ol className="flex items-center gap-1" aria-label="Return progress">
      {RETURN_STAGES.map((stage, i) => (
        <li
          key={stage}
          className={cn('h-1.5 flex-1 rounded-full', i <= index ? 'bg-gold-500' : 'bg-ink-100')}
          aria-current={i === index ? 'step' : undefined}
        />
      ))}
    </ol>
  );
}

export { Link };
