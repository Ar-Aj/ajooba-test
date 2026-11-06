import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LockKeyhole, PackageSearch, Truck } from 'lucide-react';
import { LoginForm } from '@/features/auth/components/login-form';

/**
 * Administrator sign-in.
 *
 * ## Why the page looks the way it does
 *
 * A sign-in screen is the only screen an operator sees before they trust the
 * panel with the shop. So it is not a form on a blank field: it is the panel's
 * one chance to say what this place is.
 *
 * Two columns, and each does a job:
 *
 *   - **The left is the house.** Deep navy, the wordmark, one sentence about
 *     what the panel is for, and three lines naming the work it holds — orders,
 *     catalogue, stock. It is also where the page spends its space, so the
 *     screen reads as a place rather than a modal that lost its dialog.
 *   - **The right is the door.** The form, at a comfortable measure, with the
 *     panel's own facts beneath it: who may enter, how long a session lasts.
 *
 * On a phone the navy column becomes a compact header band, because a phone
 * sign-in should be a form and nothing else — but it keeps the wordmark and the
 * one sentence, so the phone still knows whose door it is standing at.
 *
 * The page is a **server component**: it renders the heading and the layout
 * without waiting for JavaScript. Only the form is a client component, because
 * only the form has state.
 */

export const metadata: Metadata = {
  title: 'Sign in',
};

/** The three things this panel actually does, named plainly. */
const WORK = [
  {
    icon: PackageSearch,
    title: 'The catalogue',
    detail: 'Designs, colourways, photography and the price on every SKU.',
  },
  {
    icon: Truck,
    title: 'Orders and stock',
    detail: 'What has been paid, what is waiting to be packed, what has run out.',
  },
  {
    icon: LockKeyhole,
    title: 'The record',
    detail: 'Every change is attributed and kept. Nothing here is silent.',
  },
] as const;

export default function AdminLoginPage() {
  return (
    <main className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.15fr_1fr] xl:grid-cols-[1.3fr_1fr]">
      {/* ---- the house (laptop) ------------------------------------------ */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-navy-950 px-10 py-12 lg:flex xl:px-16 xl:py-16">
        {/*
          The one ornament on the page: a rose-gold hairline arc that reads as
          the sweep of a shoe's sole. Drawn, not photographed, and at 6% opacity
          so it never competes with the words.
        */}
        <svg
          aria-hidden="true"
          viewBox="0 0 600 600"
          className="pointer-events-none absolute -bottom-32 -right-40 h-[36rem] w-[36rem] text-rose-400 opacity-[0.07]"
        >
          <circle cx="300" cy="300" r="290" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="300" cy="300" r="230" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="300" cy="300" r="170" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="300" cy="300" r="110" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>

        <div className="relative">
          <p className="flex items-baseline gap-2.5">
            <span className="font-serif text-2xl tracking-[0.2em] text-white">AJOOBA</span>
            <span className="text-sm font-medium tracking-[0.14em] text-rose-300/70">ADMIN</span>
          </p>
        </div>

        <div className="relative max-w-xl">
          <h1 className="font-serif text-[clamp(2rem,2.6vw,3.25rem)] leading-[1.06] tracking-[-0.02em] text-white">
            The shop, from the back of the house.
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-white/60">
            Orders, catalogue, stock and merchandising for Ajooba Footwear. Every figure in this
            panel is derived from live records — there are no sample numbers anywhere here.
          </p>

          <ul className="mt-10 space-y-px">
            {WORK.map((item) => {
              const Icon = item.icon;
              return (
                <li
                  key={item.title}
                  className="flex items-start gap-4 border-t border-white/10 py-4 first:border-t-0 first:pt-0"
                >
                  <Icon className="mt-1 h-4 w-4 shrink-0 text-rose-400/80" strokeWidth={1.75} />
                  <div>
                    <p className="text-base font-semibold text-white/90">{item.title}</p>
                    <p className="mt-0.5 text-base text-white/45">{item.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="relative text-sm text-white/30">
          Ajooba Footwear · Operations panel · Sessions expire after eight hours
        </p>
      </section>

      {/* ---- the door ----------------------------------------------------- */}
      <section className="flex flex-col bg-cream-100">
        {/* The phone's header band. The navy never disappears entirely. */}
        <div className="bg-navy-950 px-6 py-7 lg:hidden">
          <p className="flex items-baseline gap-2">
            <span className="font-serif text-xl tracking-[0.2em] text-white">AJOOBA</span>
            <span className="text-xs font-medium tracking-[0.14em] text-rose-300/70">ADMIN</span>
          </p>
          <p className="mt-2 text-base text-white/55">The shop, from the back of the house.</p>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-10 md:px-12 md:py-14 xl:px-20">
          <div className="w-full max-w-md">
            {/* `useSearchParams` lives inside the form, so it needs a boundary
                for the page to prerender. The fallback is the same form without
                a redirect target, which is a correct sign-in in every case. */}
            <Suspense fallback={<LoginSkeleton />}>
              <LoginForm />
            </Suspense>

            <div className="mt-10 border-t border-border pt-6 lg:hidden">
              <p className="text-sm leading-relaxed text-ink-500">
                Access is restricted to administrator accounts. A forgotten password must be reset
                by another administrator; it cannot be recovered from this screen.
              </p>
            </div>
          </div>
        </div>

        <div className="hidden shrink-0 border-t border-border px-12 py-6 lg:block xl:px-20">
          <p className="text-sm leading-relaxed text-ink-500">
            Access is restricted to administrator accounts. A forgotten password must be reset by
            another administrator; it cannot be recovered from this screen.
          </p>
        </div>
      </section>
    </main>
  );
}

/** The form's shape, so the page does not jump when the client component mounts. */
function LoginSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="h-9 w-40 rounded bg-panel-200" />
      <div className="mt-3 h-4 w-56 rounded bg-panel-200/70" />
      <div className="mt-8 space-y-5">
        <div className="h-[4.6rem] rounded-lg bg-panel-200/70" />
        <div className="h-[4.6rem] rounded-lg bg-panel-200/70" />
        <div className="h-12 rounded-lg bg-panel-200" />
      </div>
    </div>
  );
}
