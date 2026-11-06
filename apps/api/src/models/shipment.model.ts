import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Shipments.
 *
 * A shipment is **deliberately separate** from the order. An order can be
 * `processing` while a shipment is `awb_assigned`, and conflating the two is
 * how a store ends up telling a customer an order "shipped" when all that
 * happened was a label being generated.
 *
 * The state machine here is ours, not Shiprocket's. The provider's own status
 * vocabulary is kept verbatim in `trackingStatus` so a diagnosis is possible
 * without guessing at a translation, but the platform's own `status` is what
 * the storefront and the admin panel read.
 *
 * The order id is unique: one order has at most one live shipment. A
 * cancelled shipment can be replaced by a new one only after the old row is
 * marked cancelled — which is what the unique *partial* index below
 * enforces.
 */

const shipmentSchema = new Schema(
  {
    /** The order this shipment fulfils. */
    orderId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderNumber: { type: String, required: true },

    /**
     * Our own lifecycle.
     *
     * `pending`    — recorded, not yet sent to the provider
     * `created`    — the provider accepted the order
     * `awb_assigned` — a waybill exists
     * `manifested` — handed to the courier
     * `shipped`    — in transit
     * `out_for_delivery` — out with the delivery agent
     * `delivered`  — delivered
     * `cancelled`  — cancelled
     * `failed`     — the provider refused it
     */
    status: {
      type: String,
      required: true,
      enum: [
        'pending',
        'created',
        'awb_assigned',
        'manifested',
        'shipped',
        'out_for_delivery',
        'delivered',
        'cancelled',
        'failed',
      ],
      default: 'pending',
      index: true,
    },

    provider: { type: String, required: true, default: 'shiprocket' },

    /** The provider's order id for this shipment. */
    providerOrderId: { type: String },
    /** The provider's shipment id. */
    providerShipmentId: { type: String },

    /** The air waybill — the number the courier tracks. */
    awbCode: { type: String },
    courierName: { type: String },
    courierId: { type: Number },

    /** The provider's own status string, kept verbatim. */
    trackingStatus: { type: String },
    trackingStatusId: { type: Number },

    /** The provider's estimated delivery date, verbatim. */
    estimatedDelivery: { type: String },

    /** Where the shipping label can be downloaded. */
    labelUrl: { type: String },

    /** When a courier pickup was requested. */
    pickupRequestedAt: { type: Date },

    /**
     * Why the shipment failed.
     *
     * A failed shipment is a real operational state: the address is wrong,
     * the pincode is unserviceable, the AWB could not be assigned. It is
     * recorded rather than thrown away so the order is not silently stuck.
     */
    failureReason: { type: String },

    /** The courier's scans, most recent last. Capped to keep the row small. */
    scans: {
      type: [
        new Schema(
          {
            date: { type: String },
            status: { type: String },
            activity: { type: String },
            location: { type: String },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /**
     * The `order_id` sent to the provider.
     *
     * Kept because Shiprocket rejects reusing the id of a cancelled order,
     * so a re-dispatch of a cancelled shipment needs a distinct identifier.
     */
    providerReference: { type: String },

    /** Free-form note recorded with the shipment. */
    note: { type: String },
  },
  {
    timestamps: true,
    collection: 'shipments',
  },
);

/*
 * One live shipment per order.
 *
 * The partial filter means only a non-cancelled shipment blocks a second one,
 * so a cancelled shipment can legitimately be replaced by a new dispatch
 * while the history of the first is preserved.
 *
 * The filter is written with `$in` rather than `$nin` **on purpose**.
 * MongoDB rejects `$nin` inside a `partialFilterExpression` — it rewrites it
 * to `$not`, and then refuses the index with:
 *
 *   Expression not supported in partial index: $not
 *
 * That is not a warning. `createIndexes` fails, and because Mongoose's
 * `autoIndex` is fire-and-forget the failure is silent: the server starts
 * perfectly happily, `createShipment` still refuses a duplicate in
 * application code, but the database constraint that is supposed to make a
 * concurrent double-dispatch *impossible* has never existed — in any
 * environment. The `$in` form is equivalent and is accepted.
 *
 * `$eq: true` states the same constraint positively and is also supported.
 * The `{ status: { $in: [...] } }` spelling is kept explicit because the list
 * of terminal statuses is business meaning, not an implementation detail.
 */
shipmentSchema.index(
  { orderId: 1 },
  {
    // Explicitly named, because MongoDB would otherwise auto-generate
    // `orderId_1` — and this schema declares a *second* `{ orderId: 1 }`
    // index below (`orderId_1_createdAt_-1`). Two indexes on the same key
    // with the same auto-generated name is a hard `IndexKeySpecsConflict`,
    // which again fails silently under `autoIndex` and leaves the
    // uniqueness constraint absent.
    name: 'orderId_live_unique',
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [
          'pending',
          'created',
          'awb_assigned',
          'manifested',
          'shipped',
          'out_for_delivery',
          'delivered',
        ],
      },
    },
  },
);

/* A provider order id identifies exactly one shipment. */
shipmentSchema.index({ providerOrderId: 1 }, { unique: true, sparse: true });

/* Operations: what still needs a label or a pickup. */
shipmentSchema.index({ status: 1, createdAt: -1 });
/* Diagnostics: everything known about one order's dispatch history. */
shipmentSchema.index({ orderId: 1, createdAt: -1 }, { name: 'orderId_createdAt' });
/* Tracking: look up a shipment by its waybill. */
shipmentSchema.index({ awbCode: 1 }, { sparse: true });

export type ShipmentDocument = InferSchemaType<typeof shipmentSchema>;
export const ShipmentModel = mongoose.model('Shipment', shipmentSchema);
