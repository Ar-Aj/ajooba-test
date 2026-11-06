/**
 * PROMPT 5 / PHASE 0 — read-only production-readiness inspection.
 *
 * Answers, with evidence:
 *   - catalogue counts (products, variants, images)
 *   - stock state (how many variants are still at zero)
 *   - colour-mapping coverage
 *   - categories / image_reviews / coupons / banners / homepage_sections state
 *   - orders, payments, returns, users, admin_users state
 *   - presence of any real (non-placeholder) credential-ish data
 *
 * Uses ONLY read/metadata MCP tools. Nothing is created, written, deleted,
 * updated or re-indexed. Safe to run repeatedly against the dev database.
 *
 *   node scripts/mcp/inspect-readiness.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SDK_ROOT = resolve(
  ROOT,
  'node_modules',
  '.pnpm',
  '@modelcontextprotocol+sdk@1.32.1_zod@4.6.7',
  'node_modules',
  '@modelcontextprotocol',
  'sdk',
  'dist',
  'esm',
  'client',
);

const { Client } = await import(`file:///${SDK_ROOT}/index.js`);
const { StdioClientTransport } = await import(`file:///${SDK_ROOT}/stdio.js`);

function loadEnvFile(file) {
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let value = line.substring(eq + 1).trim();
    const first = value[0];
    if ((first === '"' && value.endsWith('"')) || (first === "'" && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.substring(0, eq).trim()] = value;
  }
  return out;
}

const cfg = JSON.parse(readFileSync(resolve(ROOT, '.cursor', 'mcp.json'), 'utf8')).mcpServers
  .mongodb;
const env = { ...loadEnvFile(resolve(ROOT, '.env.mcp')), ...cfg.env };
const DB = process.env.INSPECT_DB ?? 'ajooba_development';

const transport = new StdioClientTransport({
  command: cfg.command,
  args: cfg.args.map((a) => a.replace('${workspaceFolder}', ROOT)),
  env: { ...process.env, ...env },
  stderr: 'ignore',
});
const client = new Client({ name: 'ajooba-readiness', version: '1.0.0' });
await client.connect(transport);

function strip(text) {
  return text
    .replace(/<untrusted-user-data-[^>]+>/g, '')
    .replace(/<\/untrusted-user-data-[^>]+>/g, '')
    .trim();
}

async function run(name, args, limit = 4000) {
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content ?? []).map((c) => c.text ?? '').join('\n');
    return { ok: res.isError !== true, text: strip(text).slice(0, limit) };
  } catch (error) {
    return { ok: false, text: `THREW: ${error?.message ?? error}` };
  }
}

async function count(collection) {
  const r = await run('count', { database: DB, collection });
  return r.text;
}

/** Run an aggregation and print it compactly. */
async function agg(label, collection, pipeline, limit = 2500) {
  const r = await run('aggregate', { database: DB, collection, pipeline }, limit);
  console.log(`\n### ${label}`);
  console.log(r.text);
}

console.log(`=== READ-ONLY READINESS INSPECTION :: ${DB} ===`);
console.log(new Date().toISOString());

/* ------------------------------------------------------------------------ */
/* 1. Raw counts                                                            */
/* ------------------------------------------------------------------------ */
const collections = [
  'products',
  'variants',
  'categories',
  'image_reviews',
  'banners',
  'homepage_sections',
  'content_blocks',
  'coupons',
  'users',
  'admin_users',
  'orders',
  'payments',
  'returns',
  'carts',
  'stock_movements',
  'store_settings',
  'audit_logs',
  'activity_events',
  'refresh_tokens',
  'idempotency_records',
];

console.log('\n### Document counts');
for (const c of collections) {
  console.log(`${c.padEnd(22)} ${await count(c)}`);
}

/* ------------------------------------------------------------------------ */
/* 2. Stock                                                                 */
/* ------------------------------------------------------------------------ */
await agg('Variants by photographyStatus (count, zero-stock)', 'variants', [
  {
    $group: {
      _id: '$photographyStatus',
      count: { $sum: 1 },
      stockZero: {
        $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] },
      },
      stockPositive: {
        $sum: { $cond: [{ $gt: ['$stock', 0] }, 1, 0] },
      },
      reservedNonZero: {
        $sum: { $cond: [{ $gt: ['$reservedStock', 0] }, 1, 0] },
      },
    },
  },
  { $sort: { count: -1 } },
]);

await agg('Variants WITH stock > 0', 'variants', [
  { $match: { stock: { $gt: 0 } } },
  {
    $project: {
      sku: 1,
      size: 1,
      colour: 1,
      stock: 1,
      reservedStock: 1,
      photographyStatus: 1,
    },
  },
  { $limit: 30 },
]);

await agg('Reserved-stock invariants (stock<0 or reserved<0)', 'variants', [
  { $match: { $or: [{ stock: { $lt: 0 } }, { reservedStock: { $lt: 0 } }] } },
  { $count: 'bad' },
]);

/* ------------------------------------------------------------------------ */
/* 3. Colour mapping / images                                              */
/* ------------------------------------------------------------------------ */
await agg('Variants by colour (count, stockZero, image-array size)', 'variants', [
  {
    $group: {
      _id: '$colour',
      count: { $sum: 1 },
      stockZero: { $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] } },
      withImagesArray: { $sum: { $cond: [{ $isArray: '$images' }, 1, 0] } },
      totalImages: { $sum: { $size: { $ifNull: ['$images', []] } } },
    },
  },
  { $sort: { totalImages: -1 } },
]);

await agg('Image-review queue status', 'image_reviews', [
  { $group: { _id: '$status', count: { $sum: 1 } } },
  { $sort: { count: -1 } },
]);

/* ------------------------------------------------------------------------ */
/* 4. Orders / payments / returns — leak & lifecycle audit                   */
/* ------------------------------------------------------------------------ */
await agg('Orders by (status, paymentStatus)', 'orders', [
  { $group: { _id: { s: '$status', p: '$paymentStatus' }, count: { $sum: 1 } } },
  { $sort: { count: -1 } },
]);

await agg('Payments by (provider, status)', 'payments', [
  { $group: { _id: { pr: '$provider', st: '$status' }, count: { $sum: 1 } } },
  { $sort: { count: -1 } },
]);

await agg(
  'Orders paid without a captured payment record (integrity leak)',
  'orders',
  [
    { $match: { paymentStatus: 'paid' } },
    {
      $lookup: {
        from: 'payments',
        localField: '_id',
        foreignField: 'orderId',
        as: 'pays',
      },
    },
    {
      $match: {
        pays: {
          $not: { $elemMatch: { status: { $in: ['paid', 'refunded', 'partially_refunded'] } } },
        },
      },
    },
    { $count: 'orphanedPaidOrders' },
  ],
);

await agg(
  'Orders with non-positive total (price integrity)',
  'orders',
  [{ $match: { $expr: { $lte: ['$totalAmount', 0] } } }, { $count: 'badTotals' }],
);

/* ------------------------------------------------------------------------ */
/* 5. Taxonomy / merchandising                                             */
/* ------------------------------------------------------------------------ */
await agg('Categories', 'categories', [
  { $project: { name: 1, slug: 1, isActive: 1, parentId: 1 } },
  { $limit: 40 },
]);

await agg('Products with category assigned', 'products', [
  {
    $group: {
      _id: {
        $cond: [
          {
            $or: [
              { $eq: [{ $ifNull: ['$categoryId', null] }, null] },
              { $eq: [{ $size: { $ifNull: ['$categoryIds', []] } }, 0] },
            ],
          },
          '(none)',
          '(assigned)',
        ],
      },
      count: { $sum: 1 },
    },
  },
]);

/* ------------------------------------------------------------------------ */
/* 6. Index coverage on the money paths                                    */
/* ------------------------------------------------------------------------ */
for (const c of ['orders', 'payments', 'variants', 'returns']) {
  const r = await run('collection-indexes', { database: DB, collection: c }, 3000);
  console.log(`\n### indexes :: ${c}`);
  console.log(r.text);
}

await client.close();
console.log('\n=== inspection complete (read-only) ===');