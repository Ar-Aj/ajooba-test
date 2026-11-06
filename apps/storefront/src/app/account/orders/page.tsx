import type { Metadata } from 'next';
import { OrderListClient } from '@/features/account/components/order-list-client';

export const metadata: Metadata = {
  title: 'Your orders',
  robots: { index: false, follow: false },
};

export default function OrdersPage() {
  return (
    <div>
      <h2 className="mb-4 font-display text-xl">Orders</h2>
      <OrderListClient />
    </div>
  );
}
