import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * The administrative audit log.
 *
 * Every administrative write records who did it, what they changed, and
 * when. The log is append-only — no API route updates or deletes an
 * entry.
 *
 * The `changes` field holds a before/after diff. It is written with
 * `Mixed` because the diff shape varies per entity, but the service layer
 * is responsible for keeping secrets out of it: no password hash, no token
 * and no API secret is ever written here.
 */
const auditLogSchema = new Schema(
  {
    /** The administrator who performed the action. Null for a system action. */
    actorId: { type: Schema.Types.ObjectId, default: null, index: true },
    actorEmail: { type: String, required: true, default: 'system' },
    actorRole: { type: String, required: true, default: 'system' },
    action: {
      type: String,
      required: true,
      enum: [
        'create',
        'update',
        'delete',
        'status-change',
        'stock-adjust',
        'login',
        'import',
        // Issuing a refund moves real money; it must be greppable on its own.
        'refund',
        'refund-reconcile',
        /*
         * Fulfilment actions. Each is distinct because they have different
         * consequences and different failure modes: a dispatch that was never
         * created, an AWB that was never assigned, and a parcel that was
         * never collected are three different operational problems, and
         * collapsing them into `update` would make them indistinguishable in
         * the log.
         */
        'shipment-create',
        'shipment-awb',
        'shipment-pickup',
        'shipment-cancel',
      ],
      index: true,
    },
    /** The kind of entity that was touched, e.g. `product`, `order`, `coupon`. */
    entity: { type: String, required: true, index: true },
    /** The id of the entity that was touched. */
    entityId: { type: String, required: true, default: '' },
    /** A one-line human description of what happened. */
    summary: { type: String, required: true, default: '' },
    /** The before/after diff. Never contains secrets. */
    changes: { type: Schema.Types.Mixed, default: null },
    /** The client IP the action came from. */
    ip: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'audit_logs',
  },
);

// The admin audit feed, newest first, filtered by entity.
auditLogSchema.index({ entity: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = mongoose.model('AuditLog', auditLogSchema);
