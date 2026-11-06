import type { Metadata } from 'next';
import { CheckoutClient } from '@/features/checkout/components/checkout-client';

export const metadata: Metadata = {
  title: 'Checkout',
  description: 'Complete your Ajooba Footwear order.',
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return <CheckoutClient />;
}
