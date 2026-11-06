'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/form';
import { Radio } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { useCommerce } from '@/lib/commerce-context';
import { cartStore } from '@/lib/cart-store';
import { addressStore } from '@/lib/address-store';
import { orderStore } from '@/lib/order-store';
import type { Address, LocalOrderLine } from '@/lib/commerce-types';
import { orderTotal, shippingFor, FREE_SHIPPING_THRESHOLD } from '@/features/cart/lib/pricing';
import { CartItemList, OrderSummary } from '@/features/cart/components/cart-item-list';
import { CheckoutSteps } from './checkout-steps';
import { AddressFields, EMPTY_ADDRESS, validateAddress, type AddressDraft } from './address-fields';
import { rupees } from '@/lib/format';
import { trackCheckoutStart } from '@/lib/track';

type StepId = 'contact' | 'address' | 'delivery' | 'payment';

const STEP_ORDER: StepId[] = ['contact', 'address', 'delivery', 'payment'];

export function CheckoutClient() {
  const { toast } = useToast();
  const { cart, cartSubtotal, addresses, account } = useCommerce();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<StepId>('contact');
  const [done, setDone] = useState<StepId[]>([]);

  /** Mark a step complete, keeping the list free of duplicates. */
  const markDone = (id: StepId) =>
    setDone((current) => (current.includes(id) ? current : [...current, id]));

  const [email, setEmail] = useState(account?.email ?? '');
  const [emailError, setEmailError] = useState<string | undefined>();

  const [draft, setDraft] = useState<AddressDraft>(EMPTY_ADDRESS);
  const [addressErrors, setAddressErrors] = useState<Partial<Record<keyof AddressDraft, string>>>(
    {},
  );
  const [addressTouched, setAddressTouched] = useState<Record<string, boolean>>({});
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);

  const [delivery, setDelivery] = useState<'standard' | 'express'>('standard');
  const [placedOrder, setPlacedOrder] = useState<string | null>(null);

  const shipping = useMemo(() => {
    const base = shippingFor(cartSubtotal);
    // Express is a real paid upgrade we surface honestly as a price.
    return delivery === 'express' ? base + 149 : base;
  }, [cartSubtotal, delivery]);

  const total = orderTotal(cartSubtotal, shipping);

  // An empty cart must never reach a "pay" screen.
  useEffect(() => {
    if (cart.length === 0 && !placedOrder) {
      setStep('contact');
    }
  }, [cart.length, placedOrder]);

  /*
   * The checkout is the top of the funnel's second half, and it is reached by a
   * navigation rather than by a tap — so it is recorded on mount, once, rather
   * than from a button. An empty cart is not a checkout start: a shopper who
   * lands here with nothing to buy has not started buying anything.
   */
  useEffect(() => {
    if (cart.length === 0 || placedOrder) return;
    trackCheckoutStart({ quantity: cart.reduce((sum, line) => sum + line.quantity, 0) });
    // Deliberately mount-only. Re-running on every cart edit would record a
    // "started checkout" for each quantity nudge, which is not a start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (placedOrder) {
    return (
      <div className="container-page py-16 md:py-24">
        <div className="max-w-xl">
          <p className="label-cap text-gold-700">Order recorded</p>
          <h1 className="step-xl mt-3 text-ink-900">Thank you — {placedOrder}</h1>
          <p className="step-md mt-4 text-ink-600">
            This build does not take payments yet, so nothing has been charged and no stock has been
            reserved. In the live shop this is where you would be handed to Razorpay.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/account/orders"
              className="btn-press step-sm bg-ink-900 px-6 py-3.5 font-medium text-cream-50 hover:bg-ink-800"
            >
              View your orders
            </Link>
            <Link
              href="/products"
              className="btn-press step-sm border border-border px-6 py-3.5 font-medium text-ink-800 hover:border-ink-500"
            >
              Keep shopping
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="container-page py-16 md:py-28">
        <div className="max-w-lg">
          <h1 className="step-xl text-ink-900">There is nothing to check out</h1>
          <p className="step-md mt-4 text-ink-600">
            Your cart is empty. Add a pair first — we cannot take an order for nothing.
          </p>
          <Link
            href="/products"
            className="btn-press step-sm mt-8 inline-flex bg-ink-900 px-7 py-3.5 font-medium text-cream-50 hover:bg-ink-800"
          >
            Browse footwear
          </Link>
        </div>
      </div>
    );
  }

  function validateContact(): boolean {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setEmailError('Enter a valid email address for your order confirmation.');
      return false;
    }
    setEmailError(undefined);
    return true;
  }

  function chooseAddress(id: string) {
    setSelectedAddressId(id);
    const found = addresses.find((a) => a.id === id);
    if (found) {
      setDraft({
        label: found.label,
        fullName: found.fullName,
        phone: found.phone,
        line1: found.line1,
        line2: found.line2 ?? '',
        city: found.city,
        state: found.state,
        postalCode: found.postalCode,
      });
    }
  }

  function placeOrder() {
    const address: Address = {
      id: `addr-${Math.random().toString(36).slice(2, 10)}`,
      label: draft.label || 'Home',
      fullName: draft.fullName.trim(),
      phone: draft.phone.trim(),
      line1: draft.line1.trim(),
      line2: draft.line2.trim() || undefined,
      city: draft.city.trim(),
      state: draft.state,
      postalCode: draft.postalCode.trim(),
      country: 'India',
    };

    const lines: LocalOrderLine[] = cart.map((line) => ({
      productId: line.productId,
      productSlug: line.productSlug,
      productTitle: line.productTitle,
      variantSku: line.variantSku,
      size: line.size,
      colour: line.colour,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      imageUrl: line.imageUrl,
    }));

    startTransition(() => {
      addressStore.upsert(address);
      const order = orderStore.place({
        lines,
        subtotal: cartSubtotal,
        shipping,
        shippingAddress: address,
      });
      cartStore.clear();
      setPlacedOrder(order.number);
      toast({
        title: 'Order recorded',
        description: `Reference ${order.number}`,
        tone: 'success',
      });
    });
  }

  const stepIndex = STEP_ORDER.indexOf(step);

  const steps = [
    {
      id: 'contact',
      title: 'Contact',
      summary: done.includes('contact') ? email : undefined,
      content: (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!validateContact()) return;
            markDone('contact');
            setStep('address');
          }}
          className="space-y-4"
        >
          <Field
            label="Email address"
            htmlFor="checkout-email"
            hint="Your order confirmation and tracking link go here"
            error={emailError}
          >
            <Input
              id="checkout-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (emailError) setEmailError(undefined);
              }}
              aria-invalid={Boolean(emailError)}
              required
            />
          </Field>
          <div className="flex justify-end">
            <Button intent="primary" type="submit">
              Continue to address
            </Button>
          </div>{' '}
        </form>
      ),
    },
    {
      id: 'address',
      title: 'Delivery address',
      summary: done.includes('address') ? `${draft.fullName}, ${draft.city}` : undefined,
      content: (
        <div className="space-y-6">
          {addresses.length > 0 ? (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink-800">Use a saved address</legend>
              <div className="space-y-2">
                {addresses.map((address) => (
                  <Radio
                    key={address.id}
                    name="saved-address"
                    value={address.id}
                    checked={selectedAddressId === address.id}
                    onChange={chooseAddress}
                    label={`${address.label} — ${address.fullName}`}
                    description={`${address.line1}, ${address.city}, ${address.state} ${address.postalCode}`}
                  />
                ))}
                <Radio
                  name="saved-address"
                  value="__new"
                  checked={selectedAddressId === '__new'}
                  onChange={() => setSelectedAddressId(null)}
                  label="Ship to a new address"
                  description="Enter it below"
                />
              </div>
            </fieldset>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const errors = validateAddress(draft);
              setAddressErrors(errors);
              setAddressTouched(
                Object.fromEntries(Object.keys(EMPTY_ADDRESS).map((key) => [key, true])),
              );
              if (Object.keys(errors).length > 0) {
                toast({
                  title: 'Check the delivery address',
                  description: `${Object.keys(errors).length} field${
                    Object.keys(errors).length === 1 ? '' : 's'
                  } need attention.`,
                  tone: 'warning',
                });
                return;
              }
              markDone('address');
              setStep('delivery');
            }}
            className="space-y-4"
          >
            <AddressFields
              draft={draft}
              errors={addressErrors}
              touched={addressTouched}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              onBlur={(field) => setAddressTouched((t) => ({ ...t, [field]: true }))}
            />
            <div className="flex flex-wrap justify-between gap-3">
              <Button intent="ghost" type="button" onClick={() => setStep('contact')}>
                Back
              </Button>
              <Button intent="primary" type="submit">
                Continue to delivery
              </Button>
            </div>
          </form>
        </div>
      ),
    },
    {
      id: 'delivery',
      title: 'Delivery speed',
      summary: done.includes('delivery')
        ? delivery === 'express'
          ? 'Express · 2 days'
          : 'Standard · 4–6 days'
        : undefined,
      content: (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            markDone('delivery');
            setStep('payment');
          }}
          className="space-y-4"
        >
          <fieldset>
            <legend className="sr-only">Choose a delivery speed</legend>
            <div className="space-y-2">
              <Radio
                name="delivery"
                value="standard"
                checked={delivery === 'standard'}
                onChange={(value) => setDelivery(value as 'standard')}
                label="Standard delivery"
                description={`Reaches in 4–6 working days · ${
                  shippingFor(cartSubtotal) === 0 ? 'Free' : rupees(shippingFor(cartSubtotal))
                }`}
              />
              <Radio
                name="delivery"
                value="express"
                checked={delivery === 'express'}
                onChange={(value) => setDelivery(value as 'express')}
                label="Express delivery"
                description="Reaches in 2 working days · ₹149"
              />
            </div>
          </fieldset>
          <div className="flex flex-wrap justify-between gap-3">
            <Button intent="ghost" type="button" onClick={() => setStep('address')}>
              Back
            </Button>
            <Button intent="primary" type="submit">
              Continue to payment
            </Button>
          </div>
        </form>
      ),
    },
    {
      id: 'payment',
      title: 'Payment',
      content: (
        <div className="space-y-5">
          <div className="border-l-2 border-gold-500 pl-4">
            <p className="step-sm font-medium text-ink-900">Payment capture is not connected yet</p>
            <p className="step-sm mt-1.5 leading-relaxed text-ink-600">
              In the live shop this step hands you to Razorpay for UPI, cards, net-banking or cash
              on delivery. On this build, no payment details are requested and no money changes
              hands — pressing the button records the order locally so you can see the confirmation
              and tracking flow.
            </p>
          </div>

          <div className="flex flex-wrap justify-between gap-3">
            <Button intent="ghost" type="button" onClick={() => setStep('delivery')}>
              Back
            </Button>
            <Button intent="gold" size="lg" disabled={pending} onClick={placeOrder}>
              {pending ? 'Recording…' : `Place order · ${rupees(total)}`}
            </Button>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="container-page py-8 md:py-12">
      <header className="mb-10">
        <h1 className="step-xl text-ink-900">Checkout</h1>
        <p className="step-sm mt-2 text-ink-500">
          Step {stepIndex + 1} of {STEP_ORDER.length} · {cart.length}{' '}
          {cart.length === 1 ? 'item' : 'items'}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_20rem] lg:gap-16">
        <div>
          <CheckoutSteps
            steps={steps}
            currentStep={step}
            completedSteps={done}
            onStepChange={(id) => {
              // Allow jumping back to a completed step, and forward only one at a
              // time — no skipping past an unvalidated step.
              const target = id as StepId;
              const targetIndex = STEP_ORDER.indexOf(target);
              if (targetIndex === -1) return;
              if (targetIndex <= stepIndex || done.includes(target)) {
                setStep(target);
              }
            }}
          />
        </div>

        <aside className="space-y-8 lg:sticky lg:top-32 lg:self-start">
          <OrderSummary subtotal={cartSubtotal} shipping={shipping} total={total}>
            <p className="step-xs mt-3 text-ink-400">
              Free shipping applies above {rupees(FREE_SHIPPING_THRESHOLD)}.
            </p>
          </OrderSummary>

          <div>
            <h2 className="label-cap text-ink-400">In this order</h2>
            <div className="mt-3">
              <CartItemList lines={cart} compact />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
