export interface RazorpayCheckoutResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; email: string; contact: string };
  theme: { color: string };
  handler: (response: RazorpayCheckoutResponse) => void | Promise<void>;
  modal: { ondismiss: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => {
      open: () => void;
      on: (
        event: string,
        callback: (response: { error?: { description?: string } }) => void,
      ) => void;
    };
  }
}

/** Load the official Checkout SDK only when a shopper starts an online payment. */
export async function loadRazorpayCheckout(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (window.Razorpay) return true;

  const existing = document.querySelector<HTMLScriptElement>(
    'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
  );
  const script = existing ?? document.createElement('script');
  if (!existing) {
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    document.body.appendChild(script);
  }

  return new Promise((resolve) => {
    script.addEventListener('load', () => resolve(Boolean(window.Razorpay)), { once: true });
    script.addEventListener('error', () => resolve(false), { once: true });
    if (window.Razorpay) resolve(true);
  });
}
