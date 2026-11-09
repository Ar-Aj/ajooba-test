'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useCommerce } from '@/lib/commerce-context';
import { addressStore } from '@/lib/address-store';
import type { Address } from '@/lib/commerce-types';
import {
  AddressFields,
  EMPTY_ADDRESS,
  validateAddress,
  type AddressDraft,
} from '@/features/checkout/components/address-fields';

export function AddressBookClient() {
  const { addresses } = useCommerce();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Address | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<AddressDraft>(EMPTY_ADDRESS);
  const [errors, setErrors] = useState<Partial<Record<keyof AddressDraft, string>>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  function openAdd() {
    setDraft(EMPTY_ADDRESS);
    setErrors({});
    setTouched({});
    setEditing(null);
    setAdding(true);
  }

  function openEdit(address: Address) {
    setDraft({
      label: address.label,
      fullName: address.fullName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2 ?? '',
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
    });
    setErrors({});
    setTouched({});
    setAdding(false);
    setEditing(address);
  }

  function close() {
    setAdding(false);
    setEditing(null);
  }

  function save() {
    const validation = validateAddress(draft);
    setErrors(validation);
    setTouched(Object.fromEntries(Object.keys(EMPTY_ADDRESS).map((key) => [key, true])));
    if (Object.keys(validation).length > 0) {
      toast({
        title: 'Check the address',
        description: `${Object.keys(validation).length} field${
          Object.keys(validation).length === 1 ? '' : 's'
        } need attention.`,
        tone: 'warning',
      });
      return;
    }

    const existing = editing;
    const addressInput = {
      ...(existing?.id ? { id: existing.id } : {}),
      label: draft.label || 'Home',
      fullName: draft.fullName.trim(),
      phone: draft.phone.trim(),
      line1: draft.line1.trim(),
      line2: draft.line2.trim() || undefined,
      city: draft.city.trim(),
      state: draft.state,
      postalCode: draft.postalCode.trim(),
      country: 'India' as const,
      isDefault: existing?.isDefault ?? addresses.length === 0,
    };

    startTransition(() => {
      void addressStore
        .saveRemote(addressInput)
        .then(() => {
          toast({ title: 'Address saved', tone: 'success' });
          close();
        })
        .catch((error: unknown) => {
          toast({
            title: 'Address could not be saved',
            description: error instanceof Error ? error.message : 'Please try again in a moment.',
            tone: 'warning',
          });
        });
    });
  }

  function remove(address: Address) {
    startTransition(() => {
      void addressStore
        .removeRemote(address.id)
        .then(() => {
          toast({ title: 'Address removed', description: address.label });
        })
        .catch((error: unknown) => {
          toast({
            title: 'Address could not be removed',
            description: error instanceof Error ? error.message : 'Please try again in a moment.',
            tone: 'warning',
          });
        });
    });
  }

  function makeDefault(address: Address) {
    startTransition(() => {
      void addressStore.makeDefaultRemote(address.id).catch((error: unknown) => {
        toast({
          title: 'Could not update default address',
          description: error instanceof Error ? error.message : 'Please try again in a moment.',
          tone: 'warning',
        });
      });
    });
  }

  const dialogOpen = adding || editing !== null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Saved addresses</h2>
          <p className="mt-1 text-xs text-ink-500">
            Addresses saved while signed in are stored with your account for faster checkout across
            devices.
          </p>
        </div>
        <Button intent="primary" size="sm" onClick={openAdd}>
          Add address
        </Button>
      </div>

      {addresses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
          <h3 className="font-display text-lg">No saved addresses</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-500">
            Save an address to your account and checkout will fill it in for you next time.
          </p>
          <Button intent="gold" className="mt-5" onClick={openAdd}>
            Add your first address
          </Button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-busy={pending}>
          {addresses.map((address) => (
            <li
              key={address.id}
              className="flex flex-col rounded-2xl border border-ink-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-ink-900">{address.label}</p>
                {address.isDefault ? (
                  <span className="rounded-full bg-gold-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-800">
                    Default
                  </span>
                ) : null}
              </div>
              <address className="mt-2 text-sm not-italic leading-relaxed text-ink-600">
                {address.fullName}
                <br />
                {address.line1}
                {address.line2 ? (
                  <>
                    <br />
                    {address.line2}
                  </>
                ) : null}
                <br />
                {address.city}, {address.state} {address.postalCode}
                <br />
                <span className="text-ink-500">{address.phone}</span>
              </address>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
                <Button intent="ghost" size="sm" onClick={() => openEdit(address)}>
                  Edit
                </Button>
                {!address.isDefault ? (
                  <Button intent="ghost" size="sm" onClick={() => makeDefault(address)}>
                    Set as default
                  </Button>
                ) : null}
                <Button
                  intent="ghost"
                  size="sm"
                  className="text-claret-700"
                  onClick={() => remove(address)}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={dialogOpen}
        onClose={close}
        title={editing ? 'Edit address' : 'Add a new address'}
        description="We only use this to deliver your order."
        size="lg"
        footer={
          <>
            <Button intent="ghost" onClick={close}>
              Cancel
            </Button>
            <Button intent="primary" onClick={save} disabled={pending}>
              Save address
            </Button>
          </>
        }
      >
        <AddressFields
          draft={draft}
          errors={errors}
          touched={touched}
          onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          onBlur={(field) => setTouched((t) => ({ ...t, [field]: true }))}
        />
      </Dialog>
    </div>
  );
}
