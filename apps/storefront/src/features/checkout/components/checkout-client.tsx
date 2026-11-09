'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  Cart as ApiCart,
  Order,
  PaymentConfiguration,
  PaymentIntent,
  PaymentVerificationResult,
} from '@ajooba/contracts';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/form';
import { Radio } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { useCommerce } from '@/lib/commerce-context';
import { cartStore } from '@/lib/cart-store';
import { addressStore } from '@/lib/address-store';
import type { Address, CartLine } from '@/lib/commerce-types';
import { CartItemList, OrderSummary } from '@/features/cart/components/cart-item-list';
import { CheckoutSteps } from './checkout-steps';
import { AddressFields, EMPTY_ADDRESS, validateAddress, type AddressDraft } from './address-fields';
import { rupees } from '@/lib/format';
import { trackCheckoutStart } from '@/lib/track';
import { customerApiRequest, customerSession } from '@/lib/customer-session';
import { mediaUrl } from '@/lib/media';
import { loadRazorpayCheckout } from '@/lib/razorpay-client';

type StepId = 'contact' | 'address' | 'delivery' | 'payment';
type PaymentMethod = 'razorpay' | 'cod';

const STEP_ORDER: StepId[] = ['contact', 'address', 'delivery', 'payment'];
const COD_MAX_AMOUNT = 10_000;
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

interface StoreSettingsView {
  shippingFee: number;
  freeShippingThreshold: number;
  isCodEnabled: boolean;
}

function matchesSavedAddress(
  saved: {
    label: string;
    fullName: string;
    phone: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
  },
  current: Address,
): boolean {
  const savedDigits = saved.phone.replace(/\D/g, '').slice(-10);
  return (
    saved.label === current.label &&
    saved.fullName.trim() === current.fullName &&
    savedDigits === current.phone &&
    saved.line1.trim() === current.line1 &&
    (saved.line2 ?? '').trim() === (current.line2 ?? '') &&
    saved.city.trim() === current.city &&
    saved.state === current.state &&
    saved.postalCode.trim() === current.postalCode
  );
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
}

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');
}

function mapApiCart(cart: ApiCart): CartLine[] {
  return cart.items.map((item) => ({
    id: item.variantId,
    variantId: item.variantId,
    variantSku: item.sku,
    productId: item.productId,
    productSlug: item.slug,
    productTitle: item.title,
    colour: item.colour,
    size: item.size,
    unitMrp: item.mrp,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    addedAt: cart.updatedAt,
    ...(item.imageUrl ? { imageUrl: mediaUrl(item.imageUrl) } : {}),
  }));
}

async function fetchPublicVariantId(line: CartLine): Promise<string> {
  if (line.variantId) return line.variantId;

  const response = await fetch(
    `${apiBase()}/v1/catalog/products/${encodeURIComponent(line.productSlug)}`,
    { headers: { accept: 'application/json' }, cache: 'no-store' },
  );
  const body = (await response.json().catch(() => ({}))) as ApiEnvelope<{
    variants: Array<{ id?: string; sku: string }>;
  }>;
  const id = body.data?.variants.find((variant) => variant.sku === line.variantSku)?.id;
  if (!response.ok || !body.ok || !id) {
    throw new Error(`We could not verify ${line.variantSku}. Refresh the product and try again.`);
  }
  return id;
}

export function CheckoutClient() {
  const { toast } = useToast();
  const { cart: localCart, addresses, ready } = useCommerce();

  const [step, setStep] = useState<StepId>('contact');
  const [done, setDone] = useState<StepId[]>([]);
  const [session, setSession] = useState<ReturnType<typeof customerSession.read>>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [serverCart, setServerCart] = useState<ApiCart | null>(null);
  const [cartLoading, setCartLoading] = useState(false);
  const [cartError, setCartError] = useState<string | undefined>();
  const [retryCartSync, setRetryCartSync] = useState(0);
  const [paymentConfiguration, setPaymentConfiguration] = useState<PaymentConfiguration | null>(
    null,
  );
  const [storeSettings, setStoreSettings] = useState<StoreSettingsView | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('razorpay');
  const [paymentError, setPaymentError] = useState<string | undefined>();
  const [pendingOrder, setPendingOrder] = useState<Order | null>(null);
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);
  const [pending, setPending] = useState(false);
  const syncInFlight = useRef(false);
  const syncedCartKey = useRef<string | null>(null);
  const idempotencyKey = useRef<{ fingerprint: string; value: string } | null>(null);
  const trackedStart = useRef(false);

  /** Mark a step complete, keeping the list free of duplicates. */
  const markDone = (id: StepId) =>
    setDone((current) => (current.includes(id) ? current : [...current, id]));

  const [email, setEmail] = useState(session?.user.email ?? '');

  const [draft, setDraft] = useState<AddressDraft>(EMPTY_ADDRESS);
  const [addressErrors, setAddressErrors] = useState<Partial<Record<keyof AddressDraft, string>>>(
    {},
  );
  const [addressTouched, setAddressTouched] = useState<Record<string, boolean>>({});
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);

  const checkoutLines = useMemo(
    () => (serverCart ? mapApiCart(serverCart) : localCart),
    [localCart, serverCart],
  );

  const liveTotals = serverCart
    ? {
        subtotal: serverCart.subtotal,
        discount: serverCart.discountAmount,
        shipping: serverCart.shippingFee,
        tax: serverCart.taxAmount,
        total: serverCart.totalAmount,
      }
    : null;

  const codDisabledByCeiling = Boolean(liveTotals && liveTotals.total > COD_MAX_AMOUNT);

  useEffect(() => {
    const current = customerSession.read();
    setSession(current);
    if (current) setEmail(current.user.email);
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    if (addresses.length === 0 || selectedAddressId !== null) return;
    if (draft.fullName || draft.line1 || draft.postalCode) return;
    const preferred = addresses.find((a) => a.isDefault) ?? addresses[0];
    if (!preferred) return;
    setSelectedAddressId(preferred.id);
    setDraft({
      label: preferred.label,
      fullName: preferred.fullName,
      phone: preferred.phone.replace(/\D/g, '').slice(-10),
      line1: preferred.line1,
      line2: preferred.line2 ?? '',
      city: preferred.city,
      state: preferred.state,
      postalCode: preferred.postalCode,
    });
  }, [addresses, draft.fullName, draft.line1, draft.postalCode, selectedAddressId]);

  useEffect(() => {
    if (
      codDisabledByCeiling &&
      paymentMethod === 'cod' &&
      paymentConfiguration?.configured &&
      !pendingOrder
    ) {
      setPaymentMethod('razorpay');
    }
  }, [codDisabledByCeiling, paymentConfiguration?.configured, paymentMethod, pendingOrder]);

  useEffect(() => {
    let cancelled = false;

    async function readCheckoutSettings() {
      try {
        const [paymentResponse, settingsResponse] = await Promise.all([
          fetch(`${apiBase()}/v1/payments/configuration`, { cache: 'no-store' }),
          fetch(`${apiBase()}/v1/content/settings`, { cache: 'no-store' }),
        ]);
        const [paymentBody, settingsBody] = (await Promise.all([
          paymentResponse.json(),
          settingsResponse.json(),
        ])) as [ApiEnvelope<PaymentConfiguration>, ApiEnvelope<StoreSettingsView>];

        if (!cancelled && paymentResponse.ok && paymentBody.ok && paymentBody.data) {
          setPaymentConfiguration(paymentBody.data);
        }
        if (!cancelled && settingsResponse.ok && settingsBody.ok && settingsBody.data) {
          setStoreSettings(settingsBody.data);
          if (!paymentBody.data?.configured && settingsBody.data.isCodEnabled) {
            setPaymentMethod('cod');
          }
        }
      } catch {
        // The checkout remains unavailable until live settings are readable.
      }
    }

    void readCheckoutSettings();
    return () => {
      cancelled = true;
    };
    // Read once when checkout opens. API values are confirmed again at order creation.
  }, []);

  /*
   * Sync the device cart into the authenticated server cart. Reconcile matching
   * SKUs to the greater quantity so a refresh never double-adds the same line.
   */
  useEffect(() => {
    const cartKey = `${session?.user.id ?? ''}:${localCart
      .map((line) => `${line.variantSku}:${line.quantity}`)
      .sort()
      .join('|')}`;
    if (
      !ready ||
      !session ||
      syncInFlight.current ||
      placedOrder ||
      syncedCartKey.current === cartKey
    )
      return;

    syncInFlight.current = true;
    setCartLoading(true);
    setCartError(undefined);

    async function syncCart() {
      try {
        let liveCart = await customerApiRequest<ApiCart>('/v1/cart');
        for (const line of localCart) {
          const existing = liveCart.items.find((item) => item.sku === line.variantSku);
          const variantId = existing?.variantId ?? (await fetchPublicVariantId(line));
          if (existing) {
            const quantity = Math.max(existing.quantity, line.quantity);
            if (quantity > existing.quantity) {
              liveCart = await customerApiRequest<ApiCart>(
                `/v1/cart/items/${encodeURIComponent(variantId)}`,
                { method: 'PATCH', body: JSON.stringify({ quantity }) },
              );
            }
          } else {
            liveCart = await customerApiRequest<ApiCart>('/v1/cart/items', {
              method: 'POST',
              body: JSON.stringify({ variantId, quantity: line.quantity }),
            });
          }
        }

        liveCart = await customerApiRequest<ApiCart>('/v1/cart');
        if (liveCart.items.some((item) => !item.isAvailable)) {
          setCartError('One or more sizes are no longer available in the requested quantity.');
        } else {
          syncedCartKey.current = cartKey;
        }
        setServerCart(liveCart);
        cartStore.save(
          localCart.map((line) => ({
            ...line,
            variantId:
              liveCart.items.find((item) => item.sku === line.variantSku)?.variantId ??
              line.variantId,
          })),
        );
      } catch (error) {
        setCartError(error instanceof Error ? error.message : 'We could not verify your cart.');
      } finally {
        syncInFlight.current = false;
        setCartLoading(false);
      }
    }

    void syncCart();
  }, [localCart, placedOrder, ready, retryCartSync, session]);

  useEffect(() => {
    if (!ready || trackedStart.current || checkoutLines.length === 0 || placedOrder) return;
    trackedStart.current = true;
    trackCheckoutStart({ quantity: checkoutLines.reduce((sum, line) => sum + line.quantity, 0) });
  }, [checkoutLines, placedOrder, ready]);

  if (placedOrder) {
    return (
      <div className="container-page py-16 md:py-24">
        <div className="max-w-xl">
          <p className="label-cap text-gold-700">
            {placedOrder.paymentStatus === 'paid' ? 'Payment confirmed' : 'Order placed'}
          </p>
          <h1 className="step-xl mt-3 text-ink-900">Thank you — {placedOrder.orderNumber}</h1>
          <p className="step-md mt-4 text-ink-600">
            {placedOrder.paymentStatus === 'paid'
              ? 'Your payment has been verified by Razorpay. We have sent the order to the shop for processing.'
              : 'Your order is saved. Payment is due when it is delivered.'}
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

  if (!ready || !authChecked || cartLoading) {
    return (
      <div className="container-page py-16 md:py-24" role="status" aria-live="polite">
        <p className="step-md text-ink-600">Checking your cart, current prices and availability…</p>
      </div>
    );
  }

  if (checkoutLines.length === 0 && !cartError) {
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

  function chooseAddress(id: string) {
    setSelectedAddressId(id);
    const found = addresses.find((a) => a.id === id);
    if (found) {
      setDraft({
        label: found.label,
        fullName: found.fullName,
        phone: found.phone.replace(/\D/g, '').slice(-10),
        line1: found.line1,
        line2: found.line2 ?? '',
        city: found.city,
        state: found.state,
        postalCode: found.postalCode,
      });
    }
  }

  function currentAddress(): Address {
    return {
      id:
        selectedAddressId && selectedAddressId !== '__new'
          ? selectedAddressId
          : `addr-${Math.random().toString(36).slice(2, 10)}`,
      label: draft.label || 'Home',
      fullName: draft.fullName.trim(),
      phone: draft.phone.replace(/\D/g, '').slice(-10),
      line1: draft.line1.trim(),
      line2: draft.line2.trim() || undefined,
      city: draft.city.trim(),
      state: draft.state,
      postalCode: draft.postalCode.trim(),
      country: 'India',
      isDefault: addresses.length === 0,
    };
  }

  function completeOrder(order: Order, paid: boolean) {
    const current = currentAddress();
    const unchangedSaved = Boolean(
      selectedAddressId &&
      OBJECT_ID_RE.test(selectedAddressId) &&
      addresses.some(
        (saved) => saved.id === selectedAddressId && matchesSavedAddress(saved, current),
      ),
    );
    if (!unchangedSaved) {
      const { id: _localId, ...rest } = current;
      void addressStore
        .saveRemote(OBJECT_ID_RE.test(current.id) && selectedAddressId !== '__new' ? current : rest)
        .catch(() => {
          /* An address cache write failure never blocks a completed order. */
        });
    }
    cartStore.clear();
    setPendingOrder(null);
    setPlacedOrder(paid ? { ...order, paymentStatus: 'paid' } : order);
    toast({
      title: paid ? 'Payment verified' : 'Order placed',
      description: `Reference ${order.orderNumber}`,
      tone: 'success',
    });
  }

  async function openPaymentForOrder(order: Order) {
    const sdkReady = await loadRazorpayCheckout();
    if (!sdkReady || !window.Razorpay) {
      throw new Error(
        'The secure payment window could not load. Your order is saved; please retry.',
      );
    }

    const intent = await customerApiRequest<PaymentIntent>(`/v1/payments/${order.id}/intent`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const checkout = new window.Razorpay({
      key: intent.keyId,
      amount: intent.amount,
      currency: intent.currency,
      name: 'Ajooba Footwear',
      description: `Order ${intent.orderNumber}`,
      order_id: intent.razorpayOrderId,
      prefill: {
        name: intent.customerName,
        email: intent.customerEmail,
        contact: intent.customerPhone,
      },
      theme: { color: '#8b6b3e' },
      handler: async (response) => {
        try {
          const verification = await customerApiRequest<PaymentVerificationResult>(
            `/v1/payments/${order.id}/verify`,
            { method: 'POST', body: JSON.stringify(response) },
          );
          if (!verification.verified) {
            setPendingOrder(order);
            setPaymentError(
              verification.reason ??
                'Payment is not confirmed yet. Retry payment or check your order status.',
            );
            return;
          }
          completeOrder(order, true);
        } catch (error) {
          setPendingOrder(order);
          setPaymentError(
            error instanceof Error
              ? `${error.message} Your order is saved and its payment can be retried.`
              : 'Payment verification could not be reached. Your order is saved; please retry.',
          );
        }
      },
      modal: {
        ondismiss: () => {
          setPendingOrder(order);
          setPaymentError(
            'Payment was not completed. Your order remains unpaid and can be retried.',
          );
        },
      },
    });

    checkout.on('payment.failed', (response) => {
      setPendingOrder(order);
      setPaymentError(
        response.error?.description ?? 'Razorpay could not complete this payment. Please retry.',
      );
    });
    checkout.open();
  }

  async function placeOrder() {
    if (!serverCart || !session || pending || serverCart.items.length === 0) return;
    if (serverCart.items.some((item) => !item.isAvailable)) {
      setPaymentError('A size in your cart is no longer available. Update the cart and try again.');
      return;
    }

    const currentAddressValue = currentAddress();
    const fingerprint = JSON.stringify({
      paymentMethod,
      address: currentAddressValue,
      lines: serverCart.items.map((item) => [item.variantId, item.quantity]),
    });
    if (idempotencyKey.current?.fingerprint !== fingerprint) {
      idempotencyKey.current = {
        fingerprint,
        value:
          typeof window !== 'undefined' && window.crypto?.randomUUID
            ? window.crypto.randomUUID()
            : `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    }

    setPending(true);
    setPaymentError(undefined);
    try {
      if (paymentMethod === 'cod' && serverCart.totalAmount > COD_MAX_AMOUNT) {
        throw new Error(
          'Cash on delivery is available on orders up to ₹10,000. Pay online instead.',
        );
      }

      if (paymentMethod === 'razorpay') {
        if (!paymentConfiguration?.configured) {
          throw new Error('Online payment is not configured on this shop yet.');
        }
        const sdkReady = await loadRazorpayCheckout();
        if (!sdkReady) throw new Error('The secure payment window could not load. Try again.');
      }

      const matchedSaved =
        selectedAddressId && OBJECT_ID_RE.test(selectedAddressId)
          ? addresses.find((a) => a.id === selectedAddressId)
          : undefined;
      const shippingAddressId =
        matchedSaved && matchesSavedAddress(matchedSaved, currentAddressValue)
          ? matchedSaved.id
          : undefined;

      const order = await customerApiRequest<Order>('/v1/checkout/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current.value },
        body: JSON.stringify({
          paymentMethod,
          ...(shippingAddressId
            ? { shippingAddressId }
            : {
                shippingAddress: {
                  label: currentAddressValue.label,
                  fullName: currentAddressValue.fullName,
                  phone: `+91${currentAddressValue.phone}`,
                  line1: currentAddressValue.line1,
                  line2: currentAddressValue.line2 ?? '',
                  city: currentAddressValue.city,
                  state: currentAddressValue.state,
                  postalCode: currentAddressValue.postalCode,
                  country: 'India',
                  isDefault: false,
                },
              }),
          idempotencyKey: idempotencyKey.current.value,
        }),
      });

      if (paymentMethod === 'cod') {
        completeOrder(order, false);
        return;
      }

      setPendingOrder(order);
      await openPaymentForOrder(order);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'We could not place this order.');
    } finally {
      setPending(false);
    }
  }

  async function retryPayment() {
    if (!pendingOrder || pending) return;
    setPending(true);
    setPaymentError(undefined);
    try {
      await openPaymentForOrder(pendingOrder);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'We could not restart payment.');
    } finally {
      setPending(false);
    }
  }

  const stepIndex = STEP_ORDER.indexOf(step);

  const steps = [
    {
      id: 'contact',
      title: 'Contact',
      summary: done.includes('contact') ? email : undefined,
      content: session ? (
        <div className="space-y-4">
          <Field
            label="Order email"
            htmlFor="checkout-email"
            hint="Order updates go to the email on your account"
          >
            <Input id="checkout-email" type="email" value={email} readOnly />
          </Field>
          <div className="flex justify-end">
            <Button
              intent="primary"
              type="button"
              onClick={() => {
                markDone('contact');
                setStep('address');
              }}
            >
              Continue to address
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="step-sm max-w-prose text-ink-600">
            Sign in to place an order. This ties the purchase to your account so you can track it,
            request a return or start a size exchange later.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/login?next=%2Fcheckout"
              className="btn-press step-sm bg-ink-900 px-5 py-3 font-medium text-cream-50 hover:bg-ink-800"
            >
              Sign in
            </Link>
            <Link
              href="/register?next=%2Fcheckout"
              className="btn-press step-sm border border-border px-5 py-3 font-medium text-ink-800 hover:border-ink-500"
            >
              Create account
            </Link>
          </div>
        </div>
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
                  onChange={() => {
                    setSelectedAddressId('__new');
                    setDraft(EMPTY_ADDRESS);
                    setAddressErrors({});
                    setAddressTouched({});
                  }}
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
      title: 'Shipping',
      summary: done.includes('delivery') ? 'Calculated from live store settings' : undefined,
      content: (
        <div className="space-y-4">
          <p className="step-sm max-w-prose leading-relaxed text-ink-600">
            Shipping and any applicable tax are calculated from the shop’s current settings. The
            order summary shows the live amount, and stock is checked again before the order is
            created.
          </p>
          <div className="flex flex-wrap justify-between gap-3">
            <Button intent="ghost" type="button" onClick={() => setStep('address')}>
              Back
            </Button>
            <Button
              intent="primary"
              type="button"
              onClick={() => {
                markDone('delivery');
                setStep('payment');
              }}
              disabled={!serverCart || serverCart.items.some((item) => !item.isAvailable)}
            >
              Continue to payment
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: 'payment',
      title: 'Payment',
      content: (
        <div className="space-y-5">
          {paymentConfiguration?.configured ? (
            <Radio
              name="payment-method"
              value="razorpay"
              checked={paymentMethod === 'razorpay'}
              onChange={() => setPaymentMethod('razorpay')}
              disabled={Boolean(pendingOrder)}
              label="Pay online with Razorpay"
              description="UPI, cards and net banking in Razorpay’s secure checkout"
            />
          ) : null}
          {storeSettings?.isCodEnabled ? (
            <Radio
              name="payment-method"
              value="cod"
              checked={paymentMethod === 'cod'}
              onChange={() => setPaymentMethod('cod')}
              disabled={Boolean(pendingOrder) || codDisabledByCeiling}
              label="Cash on delivery"
              description={
                codDisabledByCeiling
                  ? 'Unavailable above ₹10,000. Pay online instead.'
                  : 'Pay the courier when your order arrives · available up to ₹10,000'
              }
            />
          ) : null}
          {!paymentConfiguration && !storeSettings ? (
            <p className="step-sm text-ink-500" role="status">
              Checking which payment methods are available…
            </p>
          ) : null}
          {!paymentConfiguration?.configured &&
          (!storeSettings?.isCodEnabled || codDisabledByCeiling) ? (
            <p className="step-sm text-claret-700" role="alert">
              {codDisabledByCeiling && storeSettings?.isCodEnabled
                ? 'Orders above ₹10,000 require online payment, which is not configured on this shop yet.'
                : 'Checkout is temporarily unavailable because no payment method is configured. No order has been created.'}
            </p>
          ) : null}
          {pendingOrder ? (
            <p className="step-sm text-ink-600" role="status">
              Order {pendingOrder.orderNumber} is saved with payment pending. Retry payment to
              complete it; we have not marked it as paid.
            </p>
          ) : null}
          {paymentError ? (
            <p className="step-sm text-claret-700" role="alert">
              {paymentError}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-between gap-3">
            <Button
              intent="ghost"
              type="button"
              onClick={() => setStep('delivery')}
              disabled={Boolean(pendingOrder)}
            >
              Back
            </Button>
            <Button
              intent="gold"
              size="lg"
              disabled={
                pending ||
                !serverCart ||
                serverCart.items.some((item) => !item.isAvailable) ||
                (paymentMethod === 'cod' &&
                  (codDisabledByCeiling || !storeSettings?.isCodEnabled)) ||
                (paymentMethod === 'razorpay' && !paymentConfiguration?.configured) ||
                (!paymentConfiguration?.configured && !storeSettings?.isCodEnabled)
              }
              onClick={pendingOrder ? retryPayment : placeOrder}
            >
              {pending
                ? 'Connecting securely…'
                : pendingOrder
                  ? 'Retry payment'
                  : paymentMethod === 'razorpay'
                    ? `Pay securely · ${rupees(serverCart?.totalAmount ?? 0)}`
                    : `Place COD order · ${rupees(serverCart?.totalAmount ?? 0)}`}
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
          Step {stepIndex + 1} of {STEP_ORDER.length} · {checkoutLines.length}{' '}
          {checkoutLines.length === 1 ? 'item' : 'items'}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_20rem] lg:gap-16">
        <div>
          {cartError ? (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-l-2 border-claret-600 pl-4">
              <p className="step-sm text-claret-700" role="alert">
                {cartError}
              </p>
              {session ? (
                <Button
                  intent="outline"
                  size="sm"
                  type="button"
                  onClick={() => {
                    syncedCartKey.current = null;
                    setRetryCartSync((value) => value + 1);
                  }}
                >
                  Check cart again
                </Button>
              ) : null}
            </div>
          ) : null}
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
          {liveTotals ? (
            <OrderSummary
              subtotal={liveTotals.subtotal}
              discount={liveTotals.discount}
              shipping={liveTotals.shipping}
              tax={liveTotals.tax}
              total={liveTotals.total}
            >
              {storeSettings && storeSettings.freeShippingThreshold > 0 ? (
                <p className="step-xs mt-3 text-ink-400">
                  Free shipping applies above {rupees(storeSettings.freeShippingThreshold)}.
                </p>
              ) : null}
            </OrderSummary>
          ) : (
            <div className="border-t-2 border-ink-900 pt-5">
              <h2 className="label-cap text-ink-400">Order summary</h2>
              <p className="step-sm mt-3 text-ink-600">
                Sign in to see the live total, shipping and stock confirmation from the shop.
              </p>
            </div>
          )}

          <div>
            <h2 className="label-cap text-ink-400">In this order</h2>
            <div className="mt-3">
              <CartItemList lines={checkoutLines} compact readOnly />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
