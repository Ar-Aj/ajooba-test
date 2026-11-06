import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Idempotency records.
 *
 * An operation that must not be duplicated — placing an order, creating a
 * refund, adjusting stock in bulk — is issued a client-supplied
 * idempotency key. The first request with a given key stores its result
 * here; a repeat request with the same key returns the stored result
 * instead of performing the work again.
 *
 * The stored response is scoped to the caller: the key is unique per
 * identity and per route, so one customer can never read another's
 * response by guessing a key.
 *
 * A TTL index removes the record after 24 hours, which is longer than any
 * sane client retry window.
 */
const idempotencySchema = new Schema(
  {
    /** The client-supplied key. */
    key: { type: String, required: true },
    /** The identity domain the request came from. */
    kind: { type: String, required: true, enum: ['customer', 'admin'] },
    /** The identity that made the request. */
    subjectId: { type: Schema.Types.ObjectId, required: true },
    /** The route the key was used on, e.g. `POST /v1/checkout/orders`. */
    scope: { type: String, required: true },
    /**
     * The HTTP status of the original response, so a replay returns the
     * same status rather than a generic 200.
     */
    statusCode: { type: Number, required: true, min: 100, max: 599 },
    /** The original response body. */
    response: { type: Schema.Types.Mixed, required: true },
    /**
     * Digest of the request body the key was first used with.
     *
     * This must be declared on the schema. Mongoose runs in strict mode,
     * so a `$set` naming an undeclared path is dropped without error — the
     * record would persist with no hash, and every replay would then
     * compare the incoming digest against `undefined` and be rejected as
     * "same key, different body".
     */
    requestHash: { type: String, required: true },
    /** When the record expires. */
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'idempotency_records',
  },
);

// A key is unique per identity and per scope.
idempotencySchema.index({ kind: 1, subjectId: 1, scope: 1, key: 1 }, { unique: true });
// MongoDB removes the record once it is stale.
idempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type IdempotencyDocument = InferSchemaType<typeof idempotencySchema>;
export const IdempotencyModel = mongoose.model('Idempotency', idempotencySchema);
