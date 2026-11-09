import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const src = path.join(root, 'public', 'products');
const dest = path.join(root, 'apps', 'storefront', 'public', 'products');

if (!fs.existsSync(src)) {
  console.log('[sync-assets] Source public/products does not exist, skipping.');
  process.exit(0);
}

if (fs.existsSync(dest)) {
  try {
    const entries = fs.readdirSync(dest);
    if (entries.length > 0) {
      console.log(
        `[sync-assets] Target apps/storefront/public/products already present (${entries.length} items).`,
      );
      process.exit(0);
    }
  } catch {
    try {
      fs.rmSync(dest, { force: true, recursive: true });
    } catch {}
  }
}

try {
  const isWindows = process.platform === 'win32';
  fs.symlinkSync(src, dest, isWindows ? 'junction' : 'dir');
  console.log('[sync-assets] Linked public/products to apps/storefront/public/products successfully.');
} catch (symlinkErr) {
  console.warn(
    '[sync-assets] Symlink/junction failed, falling back to copy:',
    symlinkErr instanceof Error ? symlinkErr.message : String(symlinkErr),
  );
  try {
    fs.cpSync(src, dest, { recursive: true });
    console.log('[sync-assets] Copied public/products to apps/storefront/public/products successfully.');
  } catch (copyErr) {
    console.error(
      '[sync-assets] Failed to sync assets:',
      copyErr instanceof Error ? copyErr.message : String(copyErr),
    );
  }
}

