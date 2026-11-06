/**
 * Read-only diagnostic for admin accounts and homepage sections.
 */
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const dbName = process.env.MONGODB_DB ?? 'ajooba_development';

await mongoose.connect(uri, { dbName });
const db = mongoose.connection.db;
if (!db) throw new Error('no db');

const collections = await db.listCollections().toArray();
console.log(
  'collections:',
  collections
    .map((c) => c.name)
    .sort()
    .join(', '),
);

const admins = await db
  .collection('admin_users')
  .find({}, { projection: { email: 1, role: 1, isActive: 1, name: 1 } })
  .toArray();
console.log('\nadmin_users:');
for (const a of admins) {
  console.log(`  ${a.email} role=${a.role} active=${a.isActive} name=${a.name}`);
}

const users = await db.collection('users').countDocuments();
const orders = await db.collection('orders').countDocuments();
const variants = await db.collection('variants').countDocuments();
const sections = await db
  .collection('homepage_sections')
  .find({}, { projection: { type: 1, position: 1, isVisible: 1 } })
  .sort({ position: 1 })
  .toArray();
const banners = await db.collection('banners').find({}).toArray();

console.log(`\nusers: ${users}  orders: ${orders}  variants: ${variants}`);
console.log('\nhomepage_sections:', JSON.stringify(sections));
console.log('\nbanners:');
for (const b of banners) {
  console.log(
    `  ${String(b._id)} placement=${String(b.placement)} active=${String(b.isActive)} image=${String(b.imageUrl)}`,
  );
}

await mongoose.disconnect();
