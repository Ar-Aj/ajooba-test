'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CartLine } from './commerce-types';
import { cartStore } from './cart-store';
import { wishlistStore, type WishlistItem } from './wishlist-store';
import { addressStore } from './address-store';
import { orderStore } from './order-store';
import { returnStore } from './return-store';
import { accountStore, type LocalAccount } from './account-store';
import { customerSession, type CustomerSession } from './customer-session';
import { useLocalStore } from './use-local-store';

interface CommerceContextValue {
  /** Current cart contents, reactive. */
  cart: readonly CartLine[];
  cartCount: number;
  cartSubtotal: number;
  /** Current wishlist contents, reactive. */
  wishlist: readonly WishlistItem[];
  /**
   * False until the device's saved state has been read.
   *
   * A screen that acts on "you are signed in" must wait for this, because the
   * first render after hydration is the *server's* answer, not the device's. It
   * also lets the header hide a signed-in-only control for one frame rather than
   * flashing a "sign in" prompt at somebody who already has.
   */
  ready: boolean;
  /** True if a product (by id) is on the wishlist. */
  isWishlisted: (productId: string) => boolean;
  /** Current saved addresses, reactive. */
  addresses: ReadonlyArray<{
    id: string;
    label: string;
    fullName: string;
    phone: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: 'India';
    isDefault?: boolean;
  }>;
  /** Current orders, reactive. */
  orders: ReadonlyArray<ReturnType<typeof orderStore.list>[number]>;
  /** Returns list, reactive. */
  returns: ReturnType<typeof returnStore.list>;
  /** Current account or null. */
  account: LocalAccount | null;
}

const CommerceContext = createContext<CommerceContextValue | null>(null);

/**
 * The empty state every store renders on its first pass.
 *
 * These are the values the **server** renders, and therefore the values the
 * first client render must also use. Declared once at module scope so they are
 * referentially stable — a fresh `[]` per render would retrigger the memo below
 * for no reason.
 */
const NO_CART: readonly CartLine[] = [];
const NO_WISHLIST: readonly WishlistItem[] = [];
const NO_ADDRESSES: CommerceContextValue['addresses'] = [];
const NO_ORDERS: CommerceContextValue['orders'] = [];
const NO_RETURNS: CommerceContextValue['returns'] = [];

export function CommerceProvider({ children }: { children: ReactNode }) {
  /*
   * Each store is seeded with the value the server rendered and then filled in
   * from `localStorage` in an effect. That ordering is what keeps hydration
   * exact: the server's "0 saved" and the client's first render agree, and the
   * real count appears one frame later.
   */
  const cart = useLocalStore<readonly CartLine[]>(
    () => cartStore.list(),
    cartStore.subscribe,
    NO_CART,
  );
  const wishlist = useLocalStore<readonly WishlistItem[]>(
    () => wishlistStore.list(),
    wishlistStore.subscribe,
    NO_WISHLIST,
  );
  const addresses = useLocalStore<CommerceContextValue['addresses']>(
    () => addressStore.list(),
    addressStore.subscribe,
    NO_ADDRESSES,
  );
  const orders = useLocalStore<CommerceContextValue['orders']>(
    () => orderStore.list(),
    orderStore.subscribe,
    NO_ORDERS,
  );
  const returns = useLocalStore<CommerceContextValue['returns']>(
    () => returnStore.list(),
    returnStore.subscribe,
    NO_RETURNS,
  );
  const storedAccount = useLocalStore<LocalAccount | null>(
    () => accountStore.read(),
    accountStore.subscribe,
    null,
  );
  const session = useLocalStore<CustomerSession | null>(
    () => customerSession.read(),
    customerSession.subscribe,
    null,
  );

  const account = useMemo<LocalAccount | null>(() => {
    if (storedAccount) return storedAccount;
    if (!session) return null;
    const fullName =
      [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim() ||
      session.user.email;
    return {
      id: session.user.id,
      fullName,
      email: session.user.email,
      phone: session.user.phone,
      joinedAt: '',
    };
  }, [storedAccount, session]);

  /*
   * `ready` flips after the first effect, when every store above has read the
   * device. It is a separate piece of state rather than a value derived from the
   * stores, because "the wishlist is empty" and "the wishlist has not been read
   * yet" are different facts and only one of them may be shown to a visitor.
   */
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  /*
   * Whenever an authenticated customer session is active, hydrate the wishlist
   * and saved address book from the API so saved items follow the customer
   * across devices and browser sessions.
   */
  useEffect(() => {
    if (!ready || !session?.user.id) return;
    void wishlistStore.syncFromServer().catch(() => {
      /* Preserve cached state if the API is temporarily unreachable. */
    });
    void addressStore.syncFromServer().catch(() => {
      /* Preserve cached state if the API is temporarily unreachable. */
    });
  }, [ready, session?.user.id]);

  const value = useMemo<CommerceContextValue>(() => {
    const cartCount = cart.reduce((n, line) => n + line.quantity, 0);
    const cartSubtotal = cart.reduce((n, line) => n + line.unitPrice * line.quantity, 0);
    return {
      cart,
      cartCount,
      cartSubtotal,
      wishlist,
      ready,
      isWishlisted: (id) => wishlist.some((it) => it.productId === id),
      addresses,
      orders,
      returns,
      account,
    };
  }, [cart, wishlist, addresses, orders, returns, account, ready]);

  return <CommerceContext.Provider value={value}>{children}</CommerceContext.Provider>;
}

export function useCommerce(): CommerceContextValue {
  const ctx = useContext(CommerceContext);
  if (!ctx) {
    throw new Error('useCommerce must be used within <CommerceProvider>');
  }
  return ctx;
}
