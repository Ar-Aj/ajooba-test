import type { Metadata } from 'next';
import { CartPageClient } from '@/features/cart/components/cart-page-client';

export const metadata: Metadata = {
  title: 'Your cart',
  description: 'Review the items in your Ajooba Footwear cart.',
  // The cart is per-device state; there is nothing stable to index.
  robots: { index: false, follow: true },
};

export default function CartPage() {
  return <CartPageClient />;
}
