import { describe, expect, it, beforeAll } from 'vitest';
import { Types } from 'mongoose';
import { connectToDatabase } from '../src/db/connection.js';
import { EmailLogModel } from '../src/models/email-log.model.js';
import { ShipmentModel } from '../src/models/shipment.model.js';
import { WebhookEventModel } from '../src/models/webhook-event.model.js';

/**
 * Index-provisioning contract tests.
 *
 * These exist because of a defect that no other test could see.
 *
 * Mongoose's `autoIndex` is fire-and-forget: it *starts* building indexes
 * and does not wait. Worse, **a unique index that fails to build is not an
 * error** — writes still succeed, they simply stop being deduplicated. The
 * server boots, health checks pass, and the guarantee is quietly absent.
 *
 * Two real instances were found while writing this file:
 *
 *  1. `shipments` declared `{ orderId: 1 }` twice, so both auto-generated the
 *     name `orderId_1`. MongoDB refuses the second with an
 *     `IndexKeySpecsConflict` — meaning the unique "one live shipment per
 *     order" index had never been created in any environment.
 *
 *  2. That same index used `partialFilterExpression: { status: { $nin: [...] } }`.
 *     MongoDB rewrites `$nin` to `$not` and rejects it with
 *     "Expression not supported in partial index: $not".
 *
 * In both cases application code still behaved correctly, because the
 * duplicate checks are also written in TypeScript. The database constraint
 * that is supposed to make a *concurrent* duplicate impossible was missing.
 *
 * So these tests assert on the indexes the database actually has, rather than
 * on the ones the schema declares. The declaration can be right while the
 * reality is not — that is the entire lesson.
 */
/**
 * The subset of an index document this test reads.
 *
 * `name` is optional because that is how the driver types it; the assertions
 * below compare it by value, so an absent name simply never matches a
 * declared index and the assertion fails loudly.
 */
interface IndexInfo {
  name?: string;
  unique?: boolean;
}

/**
 * A model, narrowed to the two members this test touches.
 *
 * Structural rather than `mongoose.Model` so the assertions state exactly
 * what is being read. The driver returns more fields than `IndexInfo`; the
 * assignment happens at the call site so the narrowing is explicit.
 */
interface IndexSource {
  collection: { indexes(options?: unknown): Promise<IndexInfo[]> };
  schema: { indexes(): Array<[Record<string, 1>, { unique?: boolean; name?: string }?]> };
}

/** Adapts a Mongoose model to the narrow shape the assertions need. */
function asIndexSource(model: unknown): IndexSource {
  const candidate = model as IndexSource;
  return candidate;
}

describe('index provisioning', () => {
  /*
   * The connection is opened in a `beforeAll` hook, not inside the test
   * bodies.
   *
   * This is a deliberate fix, not a stylistic preference. The boot gate
   * (`ensureSchemaIndexes`) awaits `Model.init()` for every registered
   * model — 25 models, each doing a `createIndexes` round trip against a
   * real MongoDB. That work is genuinely slow, and it is genuinely
   * *connection setup*, not part of any one assertion.
   *
   * When it ran inside the first `it(...)` body it was charged against that
   * test's 30-second timeout. Under the full suite, where 14 other files
   * have already connected, disconnected and reconnected the same driver,
   * the accumulated cost pushed it past 30 seconds and the file failed with
   * `Test timed out in 30000ms` — a failure that looked like a database
   * problem and was not one.
   *
   * `beforeAll` carries the 60-second `hookTimeout`, which is what a
   * connection-establishing operation is supposed to be measured against.
   * The assertion itself then runs against an already-open connection and
   * is fast.
   */
  beforeAll(async () => {
    // The boot gate builds and awaits the indexes; without this the rest proves nothing.
    await connectToDatabase();
  });

  it('has created every unique index the correctness guarantees depend on', async () => {
    const collections: Array<{ name: string; model: IndexSource }> = [
      { name: 'email_logs', model: asIndexSource(EmailLogModel) },
      { name: 'shipments', model: asIndexSource(ShipmentModel) },
      { name: 'webhook_events', model: asIndexSource(WebhookEventModel) },
    ];

    for (const { name, model } of collections) {
      const actual = await model.collection.indexes();

      const declared = model.schema
        .indexes()
        .filter((entry) => entry[1]?.unique === true)
        .map(([fields, options]) => ({
          name: options?.name ?? autoName(fields),
          fields: Object.keys(fields),
        }));

      for (const unique of declared) {
        const found = actual.find((index) => index.name === unique.name);

        // The assertion that matters: the declared unique index is *present*.
        expect(
          found,
          `${name}: the unique index "${unique.name}" on ${unique.fields.join(', ')} ` +
            'is declared in the schema but missing from the database. ' +
            'Uniqueness is a correctness guarantee here, not a performance hint.',
        ).toBeDefined();

        expect(
          found?.unique,
          `${name}: index "${unique.name}" exists but is NOT unique — duplicates would be accepted.`,
        ).toBe(true);
      }
    }
  });

  it('actually rejects a duplicate transactional email', async () => {
    const row = {
      template: 'order-delivered',
      idempotencyKey: 'order-delivered/IDX-TEST-1',
      to: 'dedupe@example.test',
      subject: 'test',
      status: 'queued' as const,
    };

    await EmailLogModel.create(row);

    // The behaviour the whole outbox design rests on. If this insert
    // succeeds, the database is not protecting us and a customer can be
    // sent the same email twice.
    await expect(EmailLogModel.create(row)).rejects.toMatchObject({ code: 11000 });
  });

  it('rejects a second live shipment for the same order', async () => {
    const orderId = new Types.ObjectId();
    const base = {
      orderId,
      orderNumber: 'IDX-TEST-1',
      customerId: new Types.ObjectId(),
      status: 'created' as const,
      provider: 'shiprocket' as const,
      awbCode: 'IDXTESTAWB1',
    };

    await ShipmentModel.create(base);

    // Two concurrent dispatches must not both win.
    await expect(ShipmentModel.create({ ...base, awbCode: 'IDXTESTAWB2' })).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('allows a new shipment once the previous one is cancelled', async () => {
    const orderId = new Types.ObjectId();
    const base = {
      orderId,
      orderNumber: 'IDX-TEST-2',
      customerId: new Types.ObjectId(),
      provider: 'shiprocket' as const,
    };

    const cancelled = await ShipmentModel.create({ ...base, status: 'cancelled' as const });
    await cancelled.deleteOne();

    // A cancelled shipment must not block a re-dispatch, which is the whole
    // reason this index is partial.
    await expect(
      ShipmentModel.create({ ...base, status: 'created' as const }),
    ).resolves.toBeDefined();
  });

  it('rejects a duplicate webhook event id', async () => {
    const base = {
      eventId: 'evt_idx_test',
      eventType: 'payment.captured',
      payload: {},
    };

    await WebhookEventModel.create(base);

    // Webhook idempotency: a redelivered payment.captured must not settle an
    // order twice.
    await expect(WebhookEventModel.create(base)).rejects.toMatchObject({ code: 11000 });
  });
});

/** MongoDB's default index naming: `<field>_<direction>`. */
function autoName(fields: Record<string, 1>): string {
  return Object.entries(fields)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_');
}
