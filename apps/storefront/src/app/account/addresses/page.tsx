import type { Metadata } from 'next';
import { AddressBookClient } from '@/features/account/components/address-book-client';

export const metadata: Metadata = {
  title: 'Saved addresses',
  robots: { index: false, follow: false },
};

export default function AddressesPage() {
  return <AddressBookClient />;
}
