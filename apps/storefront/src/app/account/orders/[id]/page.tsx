import type { Metadata } from 'next';
import { OrderDetailClient } from '@/features/account/components/order-detail-client';

export const metadata: Metadata = {
  title: 'Order details',
  robots: { index: false, follow: false },
};

export default function OrderDetailPage() {
  return <OrderDetailClient />;
}
