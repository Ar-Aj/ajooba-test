'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * The button.
 *
 * ## Two button shapes exist in this shop
 *
 * - **`primary`** — a solid ink block. The single most important action in a
 *   view, and there is only ever one of them.
 * - **`outline` / `ghost`** — type with a hairline or with nothing. Everything
 *   secondary, which is most things.
 *
 * `gold` stays for the one place the house has always used it: the positive
 * completion action inside a funnel (add to cart, place order). It is not a
 * general-purpose accent, and using it for two competing actions on one screen
 * is how an accent stops being one.
 *
 * `destructive` is claret and is refused for anything that is not actually
 * destructive.
 *
 * ## Why the radius is gone
 *
 * A 2px radius at every corner is the shape of a web form. A sharp block on a
 * cream page reads as print, which is the whole direction. The one concession is
 * the focus ring, which is rounded and off-grid because it is a browser
 * affordance, not part of the composition.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium',
    'btn-press transition-colors duration-150',
    'focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40',
  ],
  {
    variants: {
      intent: {
        primary: 'bg-ink-900 text-cream-50 hover:bg-ink-800 active:bg-ink-950',
        gold: 'bg-gold-500 text-ink-900 hover:bg-gold-400 active:bg-gold-600',
        outline: 'border border-ink-300 text-ink-900 hover:border-ink-900 hover:bg-cream-100',
        ghost: 'text-ink-800 hover:bg-cream-100 hover:text-ink-950',
        destructive: 'bg-claret-600 text-cream-50 hover:bg-claret-700',
        link: 'text-ink-900 underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-sm',
        xl: 'h-14 px-8 text-sm',
        icon: 'h-10 w-10',
      },
      block: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      intent: 'primary',
      size: 'md',
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, intent, size, block, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp ref={ref} className={cn(buttonVariants({ intent, size, block }), className)} {...props} />
  );
});

export { buttonVariants };
