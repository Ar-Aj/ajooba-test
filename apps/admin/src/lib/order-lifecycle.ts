import type { OrderStatus } from '@ajooba/contracts';

/**
 * The order lifecycle, as the panel draws it.
 *
 * ```
 * placed ──▶ processing ──▶ shipped ──▶ completed
 *    │            │            │
 *    └── cancelled └── cancelled └── cancelled
 * ```
 *
 * ## Why this table is duplicated here
 *
 * The authority on which moves are legal is `apps/api/src/services/order.service.ts`
 * — it validates every transition and answers 409 for an illegal one. This copy
 * exists so the panel can *offer* only the legal next steps instead of showing
 * five buttons and letting three of them fail.
 *
 * The duplication is deliberate and one-directional: if the two ever disagree,
 * the API wins and the operator sees its refusal. What must never happen is the
 * panel deciding a move is legal on the API's behalf, which is why
 * `updateOrderStatus` reports the server's error verbatim rather than assuming
 * success.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  Object.freeze({
    placed: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  });

/** A sentence an operator can act on, per destination status. */
export const TRANSITION_COPY: Readonly<
  Record<
    OrderStatus,
    { readonly label: string; readonly intent: string; readonly destructive: boolean }
  >
> = Object.freeze({
  placed: {
    label: 'Reopen as placed',
    intent: 'The order returns to the queue awaiting action.',
    destructive: false,
  },
  processing: {
    label: 'Start processing',
    intent: 'Mark this order as being packed. The customer is told it is being prepared.',
    destructive: false,
  },
  shipped: {
    label: 'Mark shipped',
    intent: 'The order leaves the workshop. The customer is told it is on its way.',
    destructive: false,
  },
  completed: {
    label: 'Mark delivered',
    intent: 'The order is finished. This is terminal and cannot be undone.',
    destructive: false,
  },
  cancelled: {
    label: 'Cancel order',
    intent:
      'Cancel this order and return its stock to the catalogue. This is terminal and cannot be undone.',
    destructive: true,
  },
});

/** True when the customer must be told something happened. */
export function transitionNotifies(next: OrderStatus): boolean {
  return next !== 'placed';
}
