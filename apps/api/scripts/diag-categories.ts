/**
 * Read-only diagnostic for the catalogue/category linkage.
 *
 * Prints counts and the actual join health between `products.subcategorySlug`
 * and the `categories` collection. It never writes.
 *
 * Usage: pnpm --filter @ajooba/api exec tsx scripts/diag-categories.ts
 */
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const dbName = process.env.MONGODB_DB ?? 'ajooba_development';

await mongoose.connect(uri, { dbName });
const db = mongoose.connection.db;
if (!db) throw new Error('no db');

const products = db.collection('products');
const categories = db.collection('categories');

const [productCount, categoryCount] = await Promise.all([
  products.countDocuments(),
  categories.countDocuments(),
]);

console.log(`products: ${productCount}`);
console.log(`categories: ${categoryCount}`);

const bySlug = await products
  .aggregate([
    { $group: { _id: '$subcategorySlug', label: { $first: '$subcategory' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ])
  .toArray();

console.log('\nproducts grouped by subcategorySlug:');
for (const row of bySlug) {
  console.log(`  ${String(row._id).padEnd(20)} count=${row.count}  label=${String(row.label)}`);
}

const cats = await categories.find({}).sort({ position: 1 }).toArray();
console.log('\ncategories:');
for (const c of cats) {
  console.log(
    `  ${String(c.slug).padEnd(20)} name=${c.displayName} parent=${c.parentSlug ?? '-'} visible=${c.isVisible} status=${c.status}`,
  );
}

const byStatus = await products
  .aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  .toArray();
console.log('\nproducts by status:', JSON.stringify(byStatus));

const orphaned = await products
  .aggregate([
    {
      $lookup: {
        from: 'categories',
        localField: 'subcategorySlug',
        foreignField: 'slug',
        as: 'match',
      },
    },
    { $match: { match: { $size: 0 } } },
    { $group: { _id: '$subcategorySlug', count: { $sum: 1 } } },
  ])
  .toArray();
console.log('\nproducts whose subcategorySlug has no category row:');
console.log(orphaned.length ? orphaned : '  (none)');

await mongoose.disconnect();
