import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import { createAdmin, createProductWithVariant } from './helpers/factories.js';
import { CategoryModel } from '../src/models/category.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import { ImportPlanModel } from '../src/models/import-plan.model.js';
import { AuditLogModel } from '../src/models/audit-log.model.js';
import { OrderModel } from '../src/models/order.model.js';
import type { ImportProductPayload, ImportVariantPayload } from '../src/services/import.service.js';
import { Types } from 'mongoose';

/**
 * Controlled catalogue import (G-6).
 *
 * ## What these tests are actually protecting
 *
 * An import writes to the whole catalogue. The failure modes that matter are
 * not "the request returned 500" — they are the quiet ones:
 *
 *  - a dry run that quietly **does** write;
 *  - an apply that happens because a field was omitted;
 *  - an apply that runs against a file that changed after approval;
 *  - a retry that **duplicates** designs or SKUs;
 *  - an import that hands a SKU a stock quantity nobody ever counted.
 *
 * Each of those has a test below.
 *
 * ## Isolation
 *
 * `useApi()` connects to the throwaway in-memory MongoDB and asserts
 * isolation before the application can open a connection (see
 * `tests/helpers/guard.ts`). Nothing here touches `ajooba_development` or any
 * persistent database.
 */

useApi();

async function adminToken(
  overrides: { role?: 'owner' | 'admin' | 'manager' | 'support' | 'content-editor' } = {},
): Promise<string> {
  const admin = await createAdmin(overrides);
  const response = await api()
    .post('/v1/admin/auth/login')
    .send({ email: admin.email, password: admin.password });
  expect(response.status).toBe(200);
  return success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
}

/**
 * Validation failures are 422 throughout this API; 403 is authorisation and
 * 409 is a conflict. Named so the assertions below read as intent.
 */
const VALIDATION = 422;
const FORBIDDEN = 403;
const UNAUTHORIZED = 401;

/** The plan shape the admin panel renders. */
interface PlanView {
  planId: string;
  status: string;
  targetDatabase: string;
  sourceFilename: string;
  payloadChecksum: string;
  payloadBytes: number;
  counts: {
    designsToCreate: number;
    designsToUpdate: number;
    variantsToCreate: number;
    variantsToUpdate: number;
    quarantine: number;
    reject: number;
    conflicts: number;
  };
  findings: ReadonlyArray<{ disposition: string; kind: string; reason: string; sku?: string }>;
  approvedByEmail: string | null;
  result: unknown;
}

/**
 * The extract JSON as a typed value.
 *
 * `JSON.parse` returns `any`, and reaching through it with dot access is
 * both unsafe and a lint error. Tests reshape the fixture repeatedly, so
 * the cast happens once here instead of at every call site.
 */
function extractRow(): ImportProductPayload {
  const parsed = JSON.parse(extractPayload()) as { products: ImportProductPayload[] };
  return parsed.products[0]!;
}

/** The one SKU every fixture design carries. */
function extractVariant(row: ImportProductPayload): ImportVariantPayload {
  return row.variants![0]!;
}

/** A minimal, valid extract: one design with one sellable-shaped SKU. */
function extractPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    products: [
      {
        code: 'A70',
        title: 'AJOOBA Import Test Mojri',
        description: 'Synthetic design for the import test suite.',
        subcategory: 'mojri-jutti',
        subcategorySlug: 'mojri-jutti',
        brand: 'Ajooba Footwear',
        colours: ['Ivory'],
        mrp: 2499,
        sellingPrice: 1749,
        images: [{ url: '/p/A70/a.jpg', sourceFile: 'a.jpg', position: 0 }],
        variants: [
          {
            sku: 'AJ-A70-IVY-06',
            size: 6,
            colour: 'Ivory',
            colourToken: 'IVY',
            mrp: 2499,
            sellingPrice: 1749,
            articleNumber: 'A70',
          },
        ],
        ...overrides,
      },
    ],
  });
}

async function dryRunPlan(token: string, payload: string, filename = 'extract.json') {
  return api()
    .post('/v1/admin/catalog/imports')
    .set(bearer(token))
    .send({ payload, sourceFilename: filename });
}

/* ========================================================================== */
/* Dry run                                                                    */
/* ========================================================================== */

describe('G-6 import dry run', () => {
  it('reports what it would do and writes nothing to the catalogue', async () => {
    const token = await adminToken();
    const payload = extractPayload();

    const response = await dryRunPlan(token, payload);
    expect(response.status).toBe(201);

    const plan = success<PlanView>(response.body);

    // The report an operator approves.
    expect(plan.counts.designsToCreate).toBe(1);
    expect(plan.counts.variantsToCreate).toBe(1);
    expect(plan.counts.quarantine).toBe(0);
    expect(plan.status).toBe('dry-run');
    expect(plan.payloadChecksum).toMatch(/^[a-f0-9]{64}$/);

    /*
     * The critical assertion. A "dry run" that writes to products or
     * variants is the single worst bug this control could have.
     */
    expect(await ProductModel.countDocuments({})).toBe(0);
    expect(await VariantModel.countDocuments({})).toBe(0);
  });

  it('states the target database so the operator can confirm it', async () => {
    const token = await adminToken();
    const plan = success<PlanView>((await dryRunPlan(token, extractPayload())).body);

    // Never a hardcoded name: it is whatever the running connection reports.
    expect(plan.targetDatabase.length).toBeGreaterThan(0);
    expect(plan.targetDatabase).not.toMatch(/production|staging/i);
  });

  it('rejects a payload that is not valid JSON', async () => {
    const token = await adminToken();
    const response = await dryRunPlan(token, 'this is not json');

    expect(response.status).toBe(VALIDATION);
    expect(failure(response.body).message).toMatch(/not valid JSON/i);
  });

  it('rejects a payload with no products array', async () => {
    const token = await adminToken();
    const response = await dryRunPlan(token, JSON.stringify({ variants: [] }));

    expect(response.status).toBe(VALIDATION);
    expect(failure(response.body).message).toMatch(/products/i);
  });

  it('records the source filename for provenance', async () => {
    const token = await adminToken();
    const plan = success<PlanView>(
      (await dryRunPlan(token, extractPayload(), 'workbook-2026-10-23.json')).body,
    );

    expect(plan.sourceFilename).toBe('workbook-2026-10-23.json');
  });

  it('refuses a filename carrying path separators', async () => {
    const token = await adminToken();

    /*
     * A filename is provenance only, never used to build a path. Allowing
     * `../` here would invite a caller to think the field addresses the
     * filesystem.
     */
    const response = await dryRunPlan(token, extractPayload(), '../../etc/passwd');

    expect(response.status).toBe(VALIDATION);
  });

  it('requires the import permission', async () => {
    // A support agent can read the catalogue but must not import into it.
    const token = await adminToken({ role: 'support' });
    const response = await dryRunPlan(token, extractPayload());

    expect(response.status).toBe(FORBIDDEN);
  });

  it('requires authentication', async () => {
    const response = await api()
      .post('/v1/admin/catalog/imports')
      .send({ payload: extractPayload(), sourceFilename: 'extract.json' });

    expect(response.status).toBe(UNAUTHORIZED);
  });
});

/* ========================================================================== */
/* Conflict detection and quarantine                                          */
/* ========================================================================== */

describe('G-6 conflict detection', () => {
  it('quarantines a duplicate design code inside the payload', async () => {
    const token = await adminToken();
    const row = extractRow();
    const payload = JSON.stringify({ products: [row, { ...row }] });

    const plan = success<PlanView>((await dryRunPlan(token, payload)).body);

    /*
     * The importer upserts on `code`, so two rows sharing one code means the
     * second silently overwrites the first. That must be reported, not
     * applied.
     */
    expect(plan.counts.quarantine).toBeGreaterThan(0);
    expect(
      plan.findings.some(
        (finding) =>
          finding.disposition === 'quarantine' && finding.reason.includes('Duplicate design code'),
      ),
    ).toBe(true);
    expect(await ProductModel.countDocuments({})).toBe(0);
  });

  it('quarantines a duplicate SKU inside the payload', async () => {
    const token = await adminToken();
    const row = extractRow();
    const variant = extractVariant(row);
    const payload = JSON.stringify({
      products: [{ ...row, variants: [variant, { ...variant }] }],
    });

    const plan = success<PlanView>((await dryRunPlan(token, payload)).body);

    expect(
      plan.findings.some(
        (finding) =>
          finding.disposition === 'quarantine' && finding.reason.includes('Duplicate SKU'),
      ),
    ).toBe(true);
  });

  it('rejects a design whose code is malformed', async () => {
    const token = await adminToken();
    const row = extractRow();
    const payload = JSON.stringify({ products: [{ ...row, code: 'NOT-A-CODE' }] });

    const plan = success<PlanView>((await dryRunPlan(token, payload)).body);

    expect(plan.counts.reject).toBe(1);
    expect(
      plan.findings.some(
        (finding) => finding.disposition === 'reject' && finding.reason.includes('code'),
      ),
    ).toBe(true);
  });

  it('quarantines a design with no category, since it cannot be placed', async () => {
    const token = await adminToken();
    const row = extractRow();
    const payload = JSON.stringify({ products: [{ ...row, subcategorySlug: '' }] });

    const plan = success<PlanView>((await dryRunPlan(token, payload)).body);

    expect(plan.counts.quarantine).toBe(1);
    expect(plan.counts.designsToCreate).toBe(0);
  });

  it('quarantines a variant whose price data is unusable', async () => {
    const token = await adminToken();
    const row = extractRow();
    const payload = JSON.stringify({
      products: [{ ...row, variants: [{ ...extractVariant(row), mrp: -1 }] }],
    });

    const plan = success<PlanView>((await dryRunPlan(token, payload)).body);

    expect(
      plan.findings.some(
        (finding) => finding.disposition === 'quarantine' && finding.reason.includes('pricing'),
      ),
    ).toBe(true);
  });

  it('classifies an existing design as an update, not a create', async () => {
    const token = await adminToken();
    await CategoryModel.create({
      slug: 'mojri-jutti',
      displayName: 'Mojri & Jutti',
      position: 0,
      status: 'active',
      sourceSubcategory: 'Mojri/Jutti',
    });
    await createProductWithVariant(
      { code: 'A70', title: 'Existing Design' },
      { sku: 'AJ-A70-IVY-06', colour: 'Ivory', colourToken: 'IVY' },
    );

    const plan = success<PlanView>((await dryRunPlan(token, extractPayload())).body);

    expect(plan.counts.designsToCreate).toBe(0);
    expect(plan.counts.designsToUpdate).toBe(1);
  });
});

/* ========================================================================== */
/* Apply authorisation                                                        */
/* ========================================================================== */

describe('G-6 apply authorisation', () => {
  it('refuses to apply without an explicit confirmation', async () => {
    const token = await adminToken();
    const plan = success<PlanView>((await dryRunPlan(token, extractPayload())).body);

    /*
     * The whole point of `confirm`. An apply must never be the result of an
     * omitted field.
     */
    const response = await api()
      .post(`/v1/admin/catalog/imports/${plan.planId}/apply`)
      .set(bearer(token))
      .send({ payloadChecksum: plan.payloadChecksum });

    expect(response.status).toBe(VALIDATION);
    expect(await ProductModel.countDocuments({})).toBe(0);
  });

  it('refuses to apply a plan the caller has not seen', async () => {
    const token = await adminToken();
    const plan = success<PlanView>((await dryRunPlan(token, extractPayload())).body);

    const response = await api()
      .post('/v1/admin/catalog/imports/plan-does-not-exist/apply')
      .set(bearer(token))
      .send({ payloadChecksum: plan.payloadChecksum, confirm: true });

    expect(response.status).toBe(VALIDATION);
    expect(failure(response.body).message).toMatch(/was not found/i);
    expect(await ProductModel.countDocuments({})).toBe(0);
  });

  it('refuses a checksum that does not match the planned payload', async () => {
    const token = await adminToken();
    const plan = success<PlanView>((await dryRunPlan(token, extractPayload())).body);

    // A checksum for a *different* file: the approved report no longer
    // describes what would be written.
    const wrong = createHash('sha256').update('a different file entirely').digest('hex');

    const response = await api()
      .post(`/v1/admin/catalog/imports/${plan.planId}/apply`)
      .set(bearer(token))
      .send({ payloadChecksum: wrong, confirm: true });

    expect(response.status).toBe(VALIDATION);
    expect(failure(response.body).message).toMatch(/does not match/i);
    expect(await ProductModel.countDocuments({})).toBe(0);
  });

  it('refuses to plan an import for a role without import:run', async () => {
    // A manager may edit the catalogue but may not import into it.
    const token = await adminToken({ role: 'manager' });

    const response = await dryRunPlan(token, extractPayload());

    expect(response.status).toBe(FORBIDDEN);
    expect(failure(response.body).message).toMatch(/import:run/);
    expect(await ProductModel.countDocuments({})).toBe(0);
    expect(await ImportPlanModel.countDocuments({})).toBe(0);
  });
});

/* ========================================================================== */
/* Apply behaviour                                                            */
/* ========================================================================== */

describe('G-6 apply', () => {
  it('creates the design and its SKU, and never invents stock', async () => {
    const token = await adminToken();
    const payload = extractPayload();
    const plan = success<PlanView>((await dryRunPlan(token, payload)).body);

    const response = await api()
      .post(`/v1/admin/catalog/imports/${plan.planId}/apply`)
      .set(bearer(token))
      .send({ payloadChecksum: plan.payloadChecksum, confirm: true });

    expect(response.status).toBe(200);
    const result = success<{
      applied: { designsCreated: number; variantsCreated: number };
      skipped: number;
    }>(response.body);
    expect(result.applied.designsCreated).toBe(1);
    expect(result.applied.variantsCreated).toBe(1);

    // Written through the application's own models.
    const product = await ProductModel.findOne({ code: 'A70' });
    expect(product).not.toBeNull();

    const variant = await VariantModel.findOne({ sku: 'AJ-A70-IVY-06' });
    expect(variant).not.toBeNull();

    /*
     * The workbook has no stock column. An import that assigned a quantity
     * would be inventing inventory, so every imported SKU starts at zero and
     * is unsellable until an administrator counts it.
     */
    expect(variant!.stock).toBe(0);
    expect(variant!.inStock).toBe(false);
    expect(variant!.photographyStatus).toBe('pending-review');
  });

  it('is idempotent — retrying does not duplicate designs or SKUs', async () => {
    const token = await adminToken();
    const payload = extractPayload();
    const first = success<PlanView>((await dryRunPlan(token, payload)).body);

    await api()
      .post(`/v1/admin/catalog/imports/${first.planId}/apply`)
      .set(bearer(token))
      .send({ payloadChecksum: first.payloadChecksum, confirm: true });

    expect(await ProductModel.countDocuments({ code: 'A70' })).toBe(1);
    expect(await VariantModel.countDocuments({ sku: 'AJ-A70-IVY-06' })).toBe(1);

    // Same file again, planned and applied a second time.
    const second = success<PlanView>((await dryRunPlan(token, payload)).body);
    const response = await api()
      .post(`/v1/admin/catalog/imports/${second.planId}/apply`)
      .set(bearer(token))
      .send({ payloadChecksum: second.payloadChecksum, confirm: true });

    expect(response.status).toBe(200);

    // Still one of each: a safe retry, not a duplicate.
    expect(await ProductModel.countDocuments({ code: 'A70' })).toBe(1);
    expect(await VariantModel.countDocuments({ sku: 'AJ-A70-IVY-06' })).toBe(1);
  });

  it('refuses to apply the same plan twice', async () => {
    const token = await adminToken();
    const payload = extractPayload();
    const plan = success<PlanView>((await dryRunPlan(token, payload)).body);

    const apply = () =>
      api()
        .post(`/v1/admin/catalog/imports/${plan.planId}/apply`)
        .set(bearer(token))
        .send({ payloadChecksum: plan.payloadChecksum, confirm: true });

    expect((await apply()).status).toBe(200);

    const second = await apply();
    expect(second.status).toBe(VALIDATION);
    expect(failure(second.body).message).toMatch(/already been applied/i);
  });

  it('skips quarantined rows rather than applying them', async () => {
    const token = await adminToken();
    const row = extractRow();
    // Two rows sharing one code: the second must not overwrite the first.
    const payload = JSON.stringify({
      products: [row, { ...row, title: 'Should Never Be Applied' }],
    });

    const plan = success<PlanView>((await dryRunPlan(token, payload)).body);
    expect(plan.counts.quarantine).toBeGreaterThan(0);

    const response = await api()
      .post(`/v1/admin/catalog/imports/${plan.planId}/apply`)
      .set(bearer(token))
      .send({ payloadChecksum: plan.payloadChecksum, confirm: true });

    expect(response.status).toBe(200);
    const result = success<{ skipped: number }>(response.body);
    expect(result.skipped).toBeGreaterThan(0);

    // The quarantined title never reached the database.
    const stored = await ProductModel.findOne({ code: 'A70' });
    expect(stored!.title).not.toBe('Should Never Be Applied');
  });

  it('records the administrator who approved it', async () => {
    const admin = await createAdmin({ role: 'owner' });
    const login = await api()
      .post('/v1/admin/auth/login')
      .send({ email: admin.email, password: admin.password });
    const token = success<{ tokens: { accessToken: string } }>(login.body).tokens.accessToken;

    const payload = extractPayload();
    const plan = success<PlanView>((await dryRunPlan(token, payload)).body);

    await api()
      .post(`/v1/admin/catalog/imports/${plan.planId}/apply`)
      .set(bearer(token))
      .send({ payloadChecksum: plan.payloadChecksum, confirm: true });

    const stored = await ImportPlanModel.findOne({ planId: plan.planId });
    expect(stored).not.toBeNull();
    expect(stored!.approvedByEmail).toBe(admin.email);
    expect(stored!.appliedAt).toBeInstanceOf(Date);

    // And it is in the audit log, attributable.
    const entry = await AuditLogModel.findOne({ entityId: plan.planId });
    expect(entry).not.toBeNull();
    expect(entry!.actorEmail).toBe(admin.email);
  });

  it('reads a plan back after applying, including its outcome', async () => {
    const token = await adminToken();
    const payload = extractPayload();
    const plan = success<PlanView>((await dryRunPlan(token, payload)).body);

    await api()
      .post(`/v1/admin/catalog/imports/${plan.planId}/apply`)
      .set(bearer(token))
      .send({ payloadChecksum: plan.payloadChecksum, confirm: true });

    const response = await api().get(`/v1/admin/catalog/imports/${plan.planId}`).set(bearer(token));

    expect(response.status).toBe(200);
    const reread = success<PlanView>(response.body);

    expect(reread.status).toBe('applied');
    expect(reread.result).not.toBeNull();
    expect(reread.approvedByEmail).not.toBeNull();
  });

  it('lists recent plans', async () => {
    const token = await adminToken();
    await dryRunPlan(token, extractPayload());

    const response = await api().get('/v1/admin/catalog/imports').set(bearer(token));
    expect(response.status).toBe(200);
    expect(success<{ items: unknown[] }>(response.body).items.length).toBeGreaterThan(0);
  });
});

/* ========================================================================== */
/* Historical data                                                            */
/* ========================================================================== */

describe('G-6 preserves history', () => {
  it('leaves orders, customers and stock history untouched', async () => {
    const token = await adminToken();
    await CategoryModel.create({
      slug: 'mojri-jutti',
      displayName: 'Mojri & Jutti',
      position: 0,
      status: 'active',
      sourceSubcategory: 'Mojri/Jutti',
    });

    const { product, variant } = await createProductWithVariant(
      { code: 'A70', title: 'Ordered Design' },
      { sku: 'AJ-A70-IVY-06', colour: 'Ivory', colourToken: 'IVY' },
    );

    const order = await OrderModel.create({
      orderNumber: 'AJ-IMPORT-0001',
      customerId: new Types.ObjectId(),
      customerName: 'Test Customer',
      customerEmail: 'test-customer@example.test',
      customerPhone: '+919876543210',
      items: [
        {
          productId: new Types.ObjectId(product.id),
          variantId: new Types.ObjectId(variant.id),
          sku: variant.sku,
          title: 'Ordered Design',
          colour: 'Ivory',
          size: 6,
          unitPrice: 1749,
          mrp: 2499,
          quantity: 1,
          lineTotal: 1749,
        },
      ],
      subtotal: 1749,
      shippingFee: 0,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: 1749,
      currency: 'INR',
      status: 'completed',
      paymentStatus: 'paid',
      paymentMethod: 'cod',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '+919876543210',
        line1: '12 Test Street',
        line2: '',
        city: 'Jaipur',
        state: 'Rajasthan',
        postalCode: '302001',
        country: 'India',
      },
      billingAddress: {
        fullName: 'Test Customer',
        phone: '+919876543210',
        line1: '12 Test Street',
        line2: '',
        city: 'Jaipur',
        state: 'Rajasthan',
        postalCode: '302001',
        country: 'India',
      },
      placedAt: new Date(),
    });

    const payload = extractPayload();
    const plan = success<PlanView>((await dryRunPlan(token, payload)).body);
    await api()
      .post(`/v1/admin/catalog/imports/${plan.planId}/apply`)
      .set(bearer(token))
      .send({ payloadChecksum: plan.payloadChecksum, confirm: true });

    // The order line still reads exactly as it did before the import.
    const reread = await OrderModel.findById(order._id);
    expect(reread).not.toBeNull();
    expect(reread!.items[0]!.sku).toBe('AJ-A70-IVY-06');
    expect(reread!.items[0]!.unitPrice).toBe(1749);
    expect(reread!.customerEmail).toBe('test-customer@example.test');
  });
});
