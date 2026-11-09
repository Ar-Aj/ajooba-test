'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { CustomerProfile } from '@ajooba/contracts';
import { Input, Field } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { customerApiRequest, customerSession } from '@/lib/customer-session';
import { optionalPhone } from '@/lib/format';

export function AccountOverviewClient() {
  const { toast } = useToast();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [orderCount, setOrderCount] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const loadAccount = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [customer, orders] = await Promise.all([
        customerApiRequest<CustomerProfile>('/v1/auth/me'),
        customerApiRequest<{ items: unknown[]; totalItems: number }>(
          '/v1/orders?page=1&pageSize=1',
        ),
      ]);
      setProfile(customer);
      setName(`${customer.firstName} ${customer.lastName}`.trim());
      setPhone(optionalPhone(customer.phone) ?? '');
      setOrderCount(orders.totalItems);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not load your account.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const session = customerSession.read();
    setAuthChecked(true);
    if (session) void loadAccount();
    else setLoading(false);
  }, [loadAccount]);

  async function save() {
    if (!profile) return;
    const names = name.trim().split(/\s+/).filter(Boolean);
    if (names.length === 0) {
      toast({ title: 'Enter your name', tone: 'warning' });
      return;
    }

    setSaving(true);
    try {
      const digits = phone.replace(/\D/g, '').slice(-10);
      const updated = await customerApiRequest<CustomerProfile>('/v1/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: names[0],
          lastName: names.slice(1).join(' '),
          ...(digits ? { phone: `+91${digits}` } : {}),
        }),
      });
      setProfile(updated);
      setName(`${updated.firstName} ${updated.lastName}`.trim());
      setPhone(optionalPhone(updated.phone) ?? '');
      toast({ title: 'Profile saved', tone: 'success' });
    } catch (cause) {
      toast({
        title: 'Profile could not be saved',
        description: cause instanceof Error ? cause.message : 'Try again in a moment.',
        tone: 'warning',
      });
    } finally {
      setSaving(false);
    }
  }

  if (!authChecked || loading) {
    return (
      <p className="step-sm text-ink-500" role="status" aria-live="polite">
        Loading your account…
      </p>
    );
  }

  if (!customerSession.read()) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-6">
        <h2 className="font-display text-xl">Sign in to view your account</h2>
        <p className="mt-2 text-sm text-ink-500">
          Sign in to see orders and update the profile stored with your account.
        </p>
        <div className="mt-4 flex gap-3">
          <Button intent="gold" asChild>
            <Link href="/login?next=%2Faccount">Sign in</Link>
          </Button>
          <Button intent="outline" asChild>
            <Link href="/register?next=%2Faccount">Create account</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="space-y-4" role="alert">
        <p className="step-sm text-claret-700">{error ?? 'Your account profile is unavailable.'}</p>
        <Button intent="outline" onClick={() => void loadAccount()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-ink-200 bg-white p-6">
        <h2 className="font-display text-xl">Profile</h2>
        <p className="mt-1 text-xs text-ink-500">Changes are saved to your customer account.</p>
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
            <Input id="acc-email" type="email" value={profile.email} disabled readOnly />
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
          <Button intent="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-ink-200 bg-white p-6">
        <h2 className="font-display text-xl">At a glance</h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Orders" value={orderCount} />
          <Stat
            label="Member since"
            value={new Date(profile.createdAt).toLocaleDateString('en-IN', {
              month: 'short',
              year: 'numeric',
            })}
          />
        </ul>
        <p className="mt-4 text-xs text-ink-500">
          Order history, saved addresses and your wishlist are stored with your account. Your
          shopping cart stays in this browser until you check out.
        </p>
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
