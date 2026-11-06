import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReturnsClient } from '@/features/account/components/returns-client';

export const metadata: Metadata = {
  title: 'Returns & tracking',
  robots: { index: false, follow: false },
};

export default function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={null}>
      <ReturnsPageInner searchParams={searchParams} />
    </Suspense>
  );
}

async function ReturnsPageInner({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const order = params.order;
  const requestedOrder = Array.isArray(order) ? order[0] : order;
  return <ReturnsClient requestedOrder={requestedOrder} />;
}
