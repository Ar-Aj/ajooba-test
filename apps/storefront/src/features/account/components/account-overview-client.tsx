'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCommerce } from '@/lib/commerce-context';
import { accountStore } from '@/lib/account-store';
import { optionalPhone } from '@/lib/format';
import { Input, Field } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';

export function AccountOverviewClient() {
  const { account, orders, addresses, cart } = useCommerce();
  const { toast } = useToast();
  const [name, setName] = useState(account?.fullName ?? '');
  const [phone, setPhone] = useState(optionalPhone(account?.phone) ?? '');

  useEffect(() => {
    setName(account?.fullName ?? '');
    setPhone(optionalPhone(account?.phone) ?? '');
  }, [account]);

  if (!account) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-6">
        <h2 className="font-display text-xl">Sign in to view your account</h2>
        <p className="mt-2 text-sm text-ink-500">
          Account data lives on this device for now. Sign in or create an account to save orders,
          addresses and your wishlist.
        </p>
        <div className="mt-4 flex gap-3">
          <Button intent="gold" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button intent="outline" asChild>
            <Link href="/register">Create account</Link>
          </Button>
        </div>
      </div>
    );
  }

  function save() {
    accountStore.write({
      ...account!,
      fullName: name.trim() || account!.fullName,
      phone: phone.trim() || undefined,
    });
    toast({ title: 'Profile updated', tone: 'success' });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-ink-200 bg-white p-6">
        <h2 className="font-display text-xl">Profile</h2>
        <p className="mt-1 text-xs text-ink-500">
          Changes are kept on this device — sign-in is not connected yet.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="acc-name">
            <Input
              id="acc-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
            />
          </Field>
          <Field label="Email" htmlFor="acc-email" hint="Used for order updates">
            <Input id="acc-email" type="email" value={account.email} disabled readOnly />
          </Field>
          <Field label="Mobile" htmlFor="acc-phone">
            <Input
              id="acc-phone"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))}
              autoComplete="tel"
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button intent="primary" onClick={save}>
            Save profile
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-ink-200 bg-white p-6">
        <h2 className="font-display text-xl">At a glance</h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Orders" value={orders.length} />
          <Stat label="Saved addresses" value={addresses.length} />
          <Stat label="Cart items" value={cart.length} />
          <Stat label="Member since" value={account.joinedAt.slice(0, 7)} />
        </ul>
        <div className="mt-4">
          <Badge intent="warning">Local-only data</Badge>
          <span className="ml-2 text-xs text-ink-500">
            This device remembers your activity. Customer accounts on a server land in the next
            phase.
          </span>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <li className="rounded-xl border border-ink-100 bg-cream-50 px-3 py-3">
      <p className="text-xs uppercase tracking-wider text-ink-500">{label}</p>
      <p className="mt-1 font-display text-xl text-ink-900">{value}</p>
    </li>
  );
}
