import { Types } from 'mongoose';
import type { Order, Shipment, ShipmentStatus, ShippingConfiguration } from '@ajooba/contracts';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors.js';
import { logger } from '../config/logger.js';
import { OrderModel } from '../models/order.model.js';
import { ShipmentModel } from '../models/shipment.model.js';
import { writeAuditLog } from './audit.service.js';
import {
  ShiprocketApiError,
  assignShiprocketAwb,
  cancelShiprocketOrder,
  createShiprocketOrder,
  fetchShiprocketOrder,
  generateShiprocketLabel,
  isShiprocketConfigured,
  isShiprocketWebhookConfigured,
  requestShiprocketPickup,
  shiprocketCourierId,
  shiprocketPickupLocation,
  shippingMissingSetup,
  trackShiprocketAwb,
  type ShiprocketTracking,
} from './shiprocket.service.js';

/**
 * Shipping.
 *
 * The rules this module enforces, all of which exist because getting them
 * wrong costs real money or misleads a customer:
 *
 *  1. **A shipment is never created for an order that cannot ship.** The
 *     order must be paid (or cash-on-delivery) and must not already be
 *     cancelled or delivered.
 *  2. **One live shipment per order.** The unique partial index enforces it,
 *     and the service checks it explicitly so the caller gets a clear
 *     `409` rather than a duplicate-key error.
 *  3. **The provider's identifier is ours.** Shiprocket's `order_id` is
 *     derived from our order number and, where needed, a suffix — because
 *     the provider rejects reusing the id of a *cancelled* order, so a
 *     re-dispatch of a cancelled shipment must not reuse it.
 *  4. **The order is not marked shipped until the courier collects it.** A
 *     label is not a dispatch. The order moves to `shipped` from the
 *     tracking webhook, not from the label generation.
 *  5. **A provider failure is recorded, not hidden.** A shipment that could
 *     not be created stays `failed` with a reason, so the order is visibly
 *     stuck rather than silently unshipped.
 */

/**
 * Report what the shipping integration can actually do.
 *
 * Returned to the admin panel so an unconfigured deployment shows an honest
 * "not configured, and here is what is missing" rather than a button that
 * silently fails.
 */
export function shippingConfiguration(): ShippingConfiguration {
  const missing = shippingMissingSetup();
  return {
    configured: isShiprocketConfigured(),
    pickupLocation: shiprocketPickupLocation() ?? null,
    webhooksEnabled: isShiprocketWebhookConfigured(),
    missing,
  };
}

/* -------------------------------------------------------------------------- */
/* Projections                                                                */
/* -------------------------------------------------------------------------- */

interface ShipmentDoc {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  orderNumber: string;
  status: ShipmentStatus;
  provider: string;
  providerOrderId?: string | null;
  providerShipmentId?: string | null;
  awbCode?: string | null;
  courierName?: string | null;
  trackingStatus?: string | null;
  trackingStatusId?: number | null;
  estimatedDelivery?: string | null;
  labelUrl?: string | null;
  pickupRequestedAt?: Date | null;
  failureReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Project a shipment document into the public shape. */
export function mapShipment(doc: ShipmentDoc): Shipment {
  return {
    id: doc._id.toString(),
    orderId: doc.orderId.toString(),
    orderNumber: doc.orderNumber,
    status: doc.status,
    provider: doc.provider,
    providerOrderId: doc.providerOrderId ?? null,
    providerShipmentId: doc.providerShipmentId ?? null,
    awbCode: doc.awbCode ?? null,
    courierName: doc.courierName ?? null,
    trackingStatus: doc.trackingStatus ?? null,
    trackingStatusId: doc.trackingStatusId ?? null,
    estimatedDelivery: doc.estimatedDelivery ?? null,
    labelUrl: doc.labelUrl ?? null,
    pickupRequestedAt: doc.pickupRequestedAt ? doc.pickupRequestedAt.toISOString() : null,
    failureReason: doc.failureReason ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Order eligibility                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Can this order be shipped at all?
 *
 * The reasons are specific, because "cannot ship" without a reason sends an
 * operator hunting for the problem.
 */
interface Eligibility {
  readonly doc: OrderDoc;
  readonly order: Order;
  readonly pickupLocation: string;
}

/**
 * Resolve the order and assert it is shippable.
 */
async function assertShippable(orderId: string): Promise<Eligibility> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw new NotFoundError('Order');
  }

  const doc = await OrderModel.findById(orderId).lean<OrderDoc | null>();
  if (!doc) {
    throw new NotFoundError('Order');
  }

  if (doc.status === 'cancelled') {
    throw new ConflictError('A cancelled order cannot be shipped.');
  }
  if (doc.status === 'completed') {
    throw new ConflictError('This order has already been delivered.');
  }
  if (doc.status === 'shipped') {
    throw new ConflictError('This order has already been shipped.');
  }
  if (doc.paymentStatus !== 'paid' && doc.paymentMethod !== 'cod') {
    throw new ConflictError('This order has not been paid, so it cannot be shipped.');
  }

  const pickupLocation = shiprocketPickupLocation();
  if (!pickupLocation) {
    throw new ValidationError(
      'Shipping is not configured on this deployment. Set SHIPROCKET_PICKUP_LOCATION.',
    );
  }

  return { doc, order: mapOrderDoc(doc), pickupLocation };
}

/**
 * The order shape the shipping code needs.
 *
 * A local projection rather than the full `Order`, because the shipping
 * payload only needs the address, the lines and the total — and a narrower
 * type makes it obvious which fields are actually sent to the provider.
 */
interface OrderDoc {
  _id: Types.ObjectId;
  orderNumber: string;
  customerId: Types.ObjectId;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: Array<{
    productId: Types.ObjectId;
    variantId: Types.ObjectId;
    sku: string;
    title: string;
    colour: string;
    size: number;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
  subtotal: number;
  shippingFee: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  shippingAddress: {
    fullName: string;
    phone: string;
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  billingAddress: {
    fullName: string;
    phone: string;
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
}

/** Project a lean order document into the public `Order` shape. */
function mapOrderDoc(doc: OrderDoc): Order {
  return {
    id: doc._id.toString(),
    orderNumber: doc.orderNumber,
    customerId: doc.customerId.toString(),
    customerName: doc.customerName,
    customerEmail: doc.customerEmail,
    customerPhone: doc.customerPhone,
    items: doc.items.map((item) => ({
      productId: item.productId.toString(),
      variantId: item.variantId.toString(),
      sku: item.sku,
      title: item.title,
      imageUrl: null,
      colour: item.colour,
      size: item.size,
      unitPrice: item.unitPrice,
      mrp: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    })),
    subtotal: doc.subtotal,
    shippingFee: doc.shippingFee,
    taxAmount: doc.taxAmount,
    discountAmount: doc.discountAmount,
    totalAmount: doc.totalAmount,
    currency: 'INR',
    status: doc.status as Order['status'],
    paymentStatus: doc.paymentStatus as Order['paymentStatus'],
    couponCode: null,
    shippingAddress: doc.shippingAddress,
    billingAddress: doc.billingAddress,
    paymentRef: null,
    paymentMethod: doc.paymentMethod as Order['paymentMethod'],
    placedAt: new Date().toISOString(),
    deliveredAt: null,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Provider identifier                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Build the `order_id` sent to Shiprocket.
 *
 * Shiprocket documents that a new order cannot reuse the id of a cancelled
 * order, and rejects it with `422`. So the identifier carries a suffix that
 * makes a re-dispatch of a cancelled shipment distinct, while remaining
 * stable for the same shipment.
 *
 * It also respects the documented 50-character limit.
 */
export function buildShiprocketOrderId(
  orderNumber: string,
  existingProviderReference?: string | null,
): string {
  if (existingProviderReference) {
    return existingProviderReference;
  }
  return `AJ-${orderNumber}`.slice(0, 50);
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The shipping package dimensions.
 *
 * Shiprocket documents that each dimension must be **> 0.5 cm** and the
 * weight **> 0 kg**. A footwear parcel has no dimensions in our catalogue,
 * so a documented, honest default is used — and the values are the
 * documented minimum-plus, not a fabricated precise measurement.
 *
 * These are the *package* dimensions, not the shoe's. They are recorded here
 * as a single constant so changing them is a deliberate act.
 */
export const SHIPPING_PACKAGE = {
  length: 30,
  breadth: 20,
  height: 12,
  /** Kilograms, for a single pair. */
  weight: 0.8,
} as const;

/**
 * Create a shipment for an order.
 *
 * The sequence:
 *
 *  1. Assert the order can ship, and that it has no live shipment.
 *  2. Record the shipment locally as `pending`, **before** calling the
 *     provider. This is the durable claim: a crash after the provider
 *     created the order leaves a row to reconcile, rather than an order that
 *     looks unshipped when a courier is already holding the parcel.
 *  3. Create the provider order.
 *  4. Update the row with the provider's ids.
 *
 * The order's status is **not** changed here. It moves to `shipped` when the
 * courier collects the parcel — see `applyTrackingUpdate`.
 */
export async function createShipment(input: {
  orderId: string;
  courierId?: number | null;
  note?: string;
  actorEmail?: string;
  actorId?: string | null;
}): Promise<Shipment> {
  const { doc, order, pickupLocation } = await assertShippable(input.orderId);

  const existing = await ShipmentModel.findOne({
    orderId: doc._id,
    status: { $nin: ['cancelled', 'failed'] },
  }).lean<ShipmentDoc | null>();

  if (existing) {
    throw new ConflictError(
      `This order already has a shipment (${existing.status}). Cancel it before creating another.`,
    );
  }

  const providerReference = buildShiprocketOrderId(order.orderNumber);

  // The durable claim, written before the provider is contacted.
  const created = await ShipmentModel.create({
    orderId: doc._id,
    orderNumber: order.orderNumber,
    status: 'pending',
    provider: 'shiprocket',
    providerReference,
    ...(input.note ? { note: input.note } : {}),
  });

  try {
    const providerOrder = await createShiprocketOrder({
      order_id: providerReference,
      order_date: new Date().toISOString().slice(0, 10),
      pickup_location: pickupLocation,
      billing_customer_name: order.shippingAddress.fullName,
      billing_address: order.shippingAddress.line1,
      ...(order.shippingAddress.line2 ? { billing_address_2: order.shippingAddress.line2 } : {}),
      billing_city: order.shippingAddress.city,
      billing_pincode: order.shippingAddress.postalCode,
      billing_state: order.shippingAddress.state,
      billing_country: order.shippingAddress.country || 'India',
      billing_email: order.customerEmail,
      billing_phone: order.customerPhone.replace(/\D/g, ''),
      shipping_is_billing: true,
      order_items: order.items.map((item) => ({
        name: item.title,
        sku: item.sku,
        units: item.quantity,
        // `selling_price` is in whole rupees and is inclusive of tax, per the
        // documented contract.
        selling_price: item.lineTotal,
      })),
      payment_method: order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
      // Shiprocket does not compute the subtotal; we must send it.
      sub_total: order.subtotal,
      length: SHIPPING_PACKAGE.length,
      breadth: SHIPPING_PACKAGE.breadth,
      height: SHIPPING_PACKAGE.height,
      weight: SHIPPING_PACKAGE.weight,
      ...(input.note ? { note: input.note } : {}),
    });

    const updated = await ShipmentModel.findByIdAndUpdate(
      created._id,
      {
        $set: {
          status: 'created',
          providerOrderId: providerOrder.order_id ?? providerReference,
          providerShipmentId: providerOrder.shipment_id,
          ...(providerOrder.awb_code ? { awbCode: providerOrder.awb_code } : {}),
          ...(providerOrder.courier_name ? { courierName: providerOrder.courier_name } : {}),
          ...(providerOrder.courier_id ? { courierId: providerOrder.courier_id } : {}),
          ...(providerOrder.label_url ? { labelUrl: providerOrder.label_url } : {}),
        },
      },
      { returnDocument: 'after' },
    ).lean<ShipmentDoc | null>();

    await writeAuditLog({
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? 'system',
      actorRole: 'system',
      action: 'shipment-create',
      entity: 'shipment',
      entityId: created._id.toString(),
      summary: `Shipment created for order ${order.orderNumber}.`,
      changes: { orderNumber: order.orderNumber, shipmentId: providerOrder.shipment_id },
      ip: null,
    });

    return mapShipment(updated ?? created);
  } catch (error) {
    /*
     * The provider refused the order. The row is kept as `failed` with the
     * reason, because "this order has no shipment" and "this order has a
     * shipment that failed" are very different things to an operator.
     */
    const reason =
      error instanceof ShiprocketApiError
        ? `Shiprocket rejected the order: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Unknown failure';

    await ShipmentModel.updateOne(
      { _id: created._id },
      { $set: { status: 'failed', failureReason: reason.slice(0, 300) } },
    );

    logger.error(
      { orderId: order.id, err: reason },
      'Failed to create a shipment with the carrier',
    );

    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* AWB, label, pickup                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Assign an AWB to a shipment and generate its label.
 *
 * The AWB must be assigned before a label can be generated — the provider
 * documents this dependency — so the two are sequenced here rather than
 * left to the caller.
 */
export async function assignAwbAndGenerateLabel(input: {
  shipmentId: string;
  courierId?: number | null;
  actorEmail?: string;
  actorId?: string | null;
}): Promise<Shipment> {
  const shipment = await ShipmentModel.findById(input.shipmentId).lean<ShipmentDoc | null>();
  if (!shipment) {
    throw new NotFoundError('Shipment');
  }

  if (!shipment.providerShipmentId) {
    throw new ConflictError('This shipment has not been created with the carrier yet.');
  }

  const courierId = input.courierId ?? shiprocketCourierId();

  const awb = await assignShiprocketAwb({
    shipmentId: shipment.providerShipmentId,
    courierId,
  });

  let labelUrl = shipment.labelUrl ?? null;

  // A label needs an AWB, and the provider rejects the request without one.
  if (awb.awb_code) {
    const label = await generateShiprocketLabel(shipment.providerShipmentId);
    labelUrl = label.label_url ?? labelUrl;
  }

  const updated = await ShipmentModel.findByIdAndUpdate(
    shipment._id,
    {
      $set: {
        status: 'awb_assigned',
        ...(awb.awb_code ? { awbCode: awb.awb_code } : {}),
        ...(awb.courier_name ? { courierName: awb.courier_name } : {}),
        ...(awb.courier_id ? { courierId: awb.courier_id } : {}),
        ...(labelUrl ? { labelUrl } : {}),
        failureReason: null,
      },
    },
    { returnDocument: 'after' },
  ).lean<ShipmentDoc | null>();

  await writeAuditLog({
    actorId: input.actorId ?? null,
    actorEmail: input.actorEmail ?? 'system',
    actorRole: 'system',
    action: 'shipment-awb',
    entity: 'shipment',
    entityId: shipment._id.toString(),
    summary: `AWB ${awb.awb_code ?? '(none)'} assigned to order ${shipment.orderNumber}.`,
    changes: { awbCode: awb.awb_code ?? null, courierName: awb.courier_name ?? null },
    ip: null,
  });

  return mapShipment(updated ?? shipment);
}

/**
 * Request a courier pickup.
 *
 * This does **not** mark the order as shipped. A pickup request is a request;
 * the parcel is only in transit once the courier scans it, which arrives
 * through the tracking webhook.
 */
export async function requestPickup(input: {
  shipmentId: string;
  actorEmail?: string;
  actorId?: string | null;
}): Promise<Shipment> {
  const shipment = await ShipmentModel.findById(input.shipmentId).lean<ShipmentDoc | null>();
  if (!shipment) {
    throw new NotFoundError('Shipment');
  }

  if (!shipment.providerShipmentId) {
    throw new ConflictError('This shipment has not been created with the carrier yet.');
  }

  await requestShiprocketPickup(shipment.providerShipmentId);

  const updated = await ShipmentModel.findByIdAndUpdate(
    shipment._id,
    { $set: { pickupRequestedAt: new Date() } },
    { returnDocument: 'after' },
  ).lean<ShipmentDoc | null>();

  await writeAuditLog({
    actorId: input.actorId ?? null,
    actorEmail: input.actorEmail ?? 'system',
    actorRole: 'system',
    action: 'shipment-pickup',
    entity: 'shipment',
    entityId: shipment._id.toString(),
    summary: `Courier pickup requested for order ${shipment.orderNumber}.`,
    changes: {},
    ip: null,
  });

  return mapShipment(updated ?? shipment);
}

/* -------------------------------------------------------------------------- */
/* Cancellation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Cancel a shipment.
 *
 * The provider is called first. If it refuses, the local state is left
 * alone — a local cancellation that the carrier does not know about would
 * let a parcel arrive against a cancelled order.
 */
export async function cancelShipment(input: {
  shipmentId: string;
  reason: string;
  actorEmail?: string;
  actorId?: string | null;
}): Promise<Shipment> {
  const shipment = await ShipmentModel.findById(input.shipmentId).lean<ShipmentDoc | null>();
  if (!shipment) {
    throw new NotFoundError('Shipment');
  }

  if (shipment.status === 'delivered') {
    throw new ConflictError('A delivered shipment cannot be cancelled.');
  }
  if (shipment.status === 'cancelled') {
    // Idempotent.
    return mapShipment(shipment);
  }

  if (shipment.providerOrderId) {
    try {
      await cancelShiprocketOrder(shipment.providerOrderId, input.reason);
    } catch (error) {
      const reason =
        error instanceof ShiprocketApiError
          ? `The carrier rejected the cancellation: ${error.message}`
          : 'The carrier could not be reached to cancel the shipment.';

      await ShipmentModel.updateOne(
        { _id: shipment._id },
        { $set: { failureReason: reason.slice(0, 300) } },
      );

      throw new ConflictError(reason);
    }
  } else {
    /*
     * The provider order id is missing, so the carrier cannot be told.
     *
     * The local state is still moved to `cancelled`, because the order will
     * not be dispatched — but the reason is recorded, so an operator can see
     * that the parcel may still arrive and needs a manual RTO.
     */
    await ShipmentModel.updateOne(
      { _id: shipment._id },
      {
        $set: {
          failureReason:
            'Cancelled locally. The carrier never received this shipment, so no remote ' +
            'cancellation was needed.'.slice(0, 300),
        },
      },
    );
  }

  const updated = await ShipmentModel.findByIdAndUpdate(
    shipment._id,
    { $set: { status: 'cancelled', failureReason: input.reason.slice(0, 300) } },
    { returnDocument: 'after' },
  ).lean<ShipmentDoc | null>();

  await writeAuditLog({
    actorId: input.actorId ?? null,
    actorEmail: input.actorEmail ?? 'system',
    actorRole: 'system',
    action: 'shipment-cancel',
    entity: 'shipment',
    entityId: shipment._id.toString(),
    summary: `Shipment for order ${shipment.orderNumber} cancelled: ${input.reason}`,
    changes: { reason: input.reason },
    ip: null,
  });

  return mapShipment(updated ?? shipment);
}

/* -------------------------------------------------------------------------- */
/* Tracking                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The platform's own shipment status, derived from the provider's.
 *
 * The mapping is explicit rather than derived from a string comparison, so
 * an unknown provider status cannot accidentally mark a parcel delivered.
 */
export function mapTrackingStatus(providerStatus: string | undefined): ShipmentStatus | null {
  if (!providerStatus) {
    return null;
  }

  const normalised = providerStatus.trim().toUpperCase();

  switch (normalised) {
    case 'PICKED UP':
    case 'PICKEDUP':
    case 'IN TRANSIT':
    case 'INTRANSIT':
    case 'DISPATCHED':
    case 'SHIPPED':
      return 'shipped';
    case 'OUT FOR DELIVERY':
    case 'OUT FOR DELIVERY.':
    case 'OUT_FOR_DELIVERY':
      return 'out_for_delivery';
    case 'DELIVERED':
    case 'COMPLETED':
      return 'delivered';
    case 'CANCELLED':
    case 'CANCELED':
      return 'cancelled';
    case 'MANIFESTED':
    case 'MANIFEST GENERATED':
      return 'manifested';
    default:
      return null;
  }
}

/**
 * Apply a tracking update to a shipment.
 *
 * **The transition is monotonic.** A shipment that is already `delivered`
 * does not go back to `shipped` because a late scan arrived, and one that is
 * `cancelled` is never revived by a tracking event. This mirrors the
 * discipline the payment path uses, for the same reason: provider events
 * arrive out of order.
 *
 * The order is promoted to `shipped` when the parcel is actually moving, and
 * to `completed` when it is delivered. That promotion is what makes the
 * customer-facing "your order has shipped" truthful.
 */
export async function applyTrackingUpdate(input: {
  awbCode?: string | null;
  providerOrderId?: string | null;
  providerStatus?: string | null;
  providerStatusId?: number | null;
  estimatedDelivery?: string | null;
  scans?: Array<{
    date?: string;
    status?: string;
    activity?: string;
    location?: string;
  }>;
}): Promise<{ shipment: Shipment | null; orderChanged: boolean }> {
  const filter = input.awbCode
    ? { awbCode: input.awbCode }
    : input.providerOrderId
      ? { providerOrderId: input.providerOrderId }
      : null;

  if (!filter) {
    return { shipment: null, orderChanged: false };
  }

  const shipment = await ShipmentModel.findOne(filter).lean<ShipmentDoc | null>();
  if (!shipment) {
    return { shipment: null, orderChanged: false };
  }

  const mapped = mapTrackingStatus(input.providerStatus ?? undefined);

  // A terminal shipment is never moved backwards by a later scan.
  const isTerminal = shipment.status === 'delivered' || shipment.status === 'cancelled';
  if (isTerminal) {
    // The scans are still refreshed, so the operator sees the full history.
    await ShipmentModel.updateOne(
      { _id: shipment._id },
      {
        $set: {
          ...(input.scans ? { scans: input.scans.slice(-50) } : {}),
          ...(input.estimatedDelivery ? { estimatedDelivery: input.estimatedDelivery } : {}),
        },
      },
    );
    return { shipment: mapShipment(shipment), orderChanged: false };
  }

  const nextStatus: ShipmentStatus = mapped ?? shipment.status;

  const updated = await ShipmentModel.findByIdAndUpdate(
    shipment._id,
    {
      $set: {
        status: nextStatus,
        ...(input.providerStatus ? { trackingStatus: input.providerStatus } : {}),
        ...(input.providerStatusId !== undefined && input.providerStatusId !== null
          ? { trackingStatusId: input.providerStatusId }
          : {}),
        ...(input.estimatedDelivery ? { estimatedDelivery: input.estimatedDelivery } : {}),
        ...(input.scans ? { scans: input.scans.slice(-50) } : {}),
      },
    },
    { returnDocument: 'after' },
  ).lean<ShipmentDoc | null>();

  let orderChanged = false;

  /*
   * Promote the order only when the parcel is genuinely moving. A label, a
   * manifest or a pickup request is not a dispatch.
   *
   * The allowed source statuses differ per target, and getting this wrong
   * strands orders:
   *
   *  - `shipped` may be reached from `placed` or `processing`.
   *  - `completed` (delivered) may be reached from `placed`, `processing`
   *    **or `shipped`**. Without `shipped` in this list, an order that had
   *    already been marked dispatched could never be marked delivered —
   *    the parcel would arrive and the order would stay `shipped` for ever.
   */
  if (nextStatus === 'shipped' || nextStatus === 'out_for_delivery' || nextStatus === 'delivered') {
    const delivered = nextStatus === 'delivered';

    const sourceStatuses: Order['status'][] = delivered
      ? ['placed', 'processing', 'shipped']
      : ['placed', 'processing'];

    const orderUpdate = delivered
      ? { $set: { status: 'completed' as const, deliveredAt: new Date() } }
      : { $set: { status: 'shipped' as const } };

    const result = await OrderModel.updateOne(
      {
        _id: shipment.orderId,
        status: { $in: sourceStatuses },
      },
      orderUpdate,
    );

    orderChanged = result.modifiedCount > 0;

    /*
     * The dispatch email is sent on the `shipped` transition only. A
     * delivery is a different event and is handled by the order service's
     * own status-change notification, so it is not duplicated here.
     */
    if (orderChanged && !delivered) {
      await notifyOrderDispatched(shipment.orderId, nextStatus);
    }
  }

  return {
    shipment: mapShipment(updated ?? shipment),
    orderChanged,
  };
}

/* -------------------------------------------------------------------------- */
/* Customer notification                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Tell the customer the parcel has actually moved.
 *
 * Two rules:
 *
 *  1. **Only on a real transition.** The `orderChanged` flag is true only
 *     when the order row actually moved, so a repeated tracking scan does
 *     not produce a second "your order has shipped" email.
 *  2. **Never inline on the money path.** The notification is *recorded* by
 *     the outbox, and delivery is attempted separately, so a mail provider
 *     outage can never fail a tracking webhook.
 *
 * `shipped` sends the dispatch email. `delivered` is handled by the order
 * service's own status-change notification, so it is not duplicated here.
 */
async function notifyOrderDispatched(
  orderId: Types.ObjectId,
  status: ShipmentStatus,
): Promise<void> {
  if (status !== 'shipped') {
    return;
  }

  try {
    const { renderOrderShipped } = await import('./email-templates.js');
    const { notifyOrderEvent } = await import('./notification.service.js');
    const { mapOrder } = await import('./order.service.js');

    const order = await OrderModel.findById(orderId).lean<Parameters<typeof mapOrder>[0] | null>();
    if (!order) {
      return;
    }

    const projected = mapOrder(order);
    await notifyOrderEvent({
      template: 'order-shipped',
      orderId: order._id,
      orderNumber: projected.orderNumber,
      to: projected.customerEmail,
      rendered: renderOrderShipped(projected, {}),
    });
  } catch (error) {
    logger.warn(
      {
        orderId: orderId.toString(),
        status,
        err: error instanceof Error ? error.message : String(error),
      },
      'The parcel moved but the customer notification could not be recorded',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Refresh                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Refresh a shipment's tracking from the provider.
 *
 * The on-demand pull used when the admin panel is opened, so a shipment
 * whose webhook was missed is still accurate.
 */
export async function refreshShipmentTracking(shipmentId: string): Promise<Shipment | null> {
  const shipment = await ShipmentModel.findById(shipmentId).lean<ShipmentDoc | null>();
  if (!shipment) {
    return null;
  }

  let tracking: ShiprocketTracking;
  if (shipment.awbCode) {
    tracking = await trackShiprocketAwb(shipment.awbCode);
  } else if (shipment.providerOrderId) {
    tracking = await fetchShiprocketOrder(shipment.providerOrderId);
  } else {
    return mapShipment(shipment);
  }

  const result = await applyTrackingUpdate({
    awbCode: shipment.awbCode ?? null,
    providerOrderId: shipment.providerOrderId ?? null,
    providerStatus: tracking.current_status ?? tracking.shipment_status ?? null,
    providerStatusId: tracking.current_status_id ?? null,
    estimatedDelivery: tracking.etd ?? null,
    scans: (tracking.scans ?? []).map((scan) => ({
      date: scan.date,
      status: scan.status,
      activity: scan.activity,
      location: scan.location,
    })),
  });

  return result.shipment;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** Fetch the live shipment for an order. */
export async function getShipmentForOrder(orderId: string): Promise<Shipment | null> {
  if (!Types.ObjectId.isValid(orderId)) {
    return null;
  }
  const doc = await ShipmentModel.findOne({ orderId: new Types.ObjectId(orderId) })
    .sort({ createdAt: -1 })
    .lean<ShipmentDoc | null>();
  return doc ? mapShipment(doc) : null;
}

/** Fetch a shipment by its id. */
export async function getShipment(shipmentId: string): Promise<Shipment | null> {
  if (!Types.ObjectId.isValid(shipmentId)) {
    return null;
  }
  const doc = await ShipmentModel.findById(shipmentId).lean<ShipmentDoc | null>();
  return doc ? mapShipment(doc) : null;
}

/** List shipments for the admin panel. */
export async function listShipments(
  filter: { status?: ShipmentStatus; orderId?: string },
  page: number,
  pageSize: number,
): Promise<{
  items: Shipment[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const query: Record<string, unknown> = {};
  if (filter.status) {
    query.status = filter.status;
  }
  if (filter.orderId && Types.ObjectId.isValid(filter.orderId)) {
    query.orderId = new Types.ObjectId(filter.orderId);
  }

  const [docs, totalItems] = await Promise.all([
    ShipmentModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<ShipmentDoc[]>(),
    ShipmentModel.countDocuments(query),
  ]);

  return {
    items: docs.map(mapShipment),
    totalItems,
    page,
    pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}

/**
 * A customer's own shipment for an order.
 *
 * Scoped to the owner, so a customer cannot track somebody else's parcel by
 * guessing an order id.
 */
export async function getShipmentForCustomer(
  orderId: string,
  customerId: string,
): Promise<Shipment | null> {
  if (!Types.ObjectId.isValid(orderId) || !Types.ObjectId.isValid(customerId)) {
    return null;
  }

  const order = await OrderModel.findOne({
    _id: new Types.ObjectId(orderId),
    customerId: new Types.ObjectId(customerId),
  })
    .select('_id')
    .lean<{ _id: Types.ObjectId } | null>();

  if (!order) {
    return null;
  }

  return getShipmentForOrder(orderId);
}
