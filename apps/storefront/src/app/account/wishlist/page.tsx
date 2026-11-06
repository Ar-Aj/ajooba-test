import type { Metadata } from 'next';
import { WishlistClient, WishlistBulkNote } from '@/features/account/components/wishlist-client';

export const metadata: Metadata = {
  title: 'Your wishlist',
  robots: { index: false, follow: false },
};

export default function WishlistPage() {
  return (
    <div>
      <h2 className="mb-4 font-display text-xl">Wishlist</h2>
      <WishlistClient />
      <WishlistBulkNote />
    </div>
  );
}
