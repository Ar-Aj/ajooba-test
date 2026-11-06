import type { HTMLAttributes, AnchorHTMLAttributes } from 'react';
import Link from 'next/link';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border',
  {
    variants: {
      intent: {
        neutral: 'border-ink-200 bg-ink-50 text-ink-700',
        gold: 'border-gold-300 bg-gold-100 text-gold-800',
        ink: 'border-ink-900 bg-ink-900 text-cream-50',
        success: 'border-ink-300 bg-cream-100 text-ink-800',
        warning: 'border-gold-300 bg-gold-50 text-gold-800',
        danger: 'border-claret-600/30 bg-claret-600/10 text-claret-700',
        outline: 'border-ink-300 bg-transparent text-ink-700',
      },
    },
    defaultVariants: { intent: 'neutral' },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, intent, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ intent }), className)} {...props} />;
}

const linkVariants = cva(
  'inline-flex items-center gap-1.5 font-medium transition-colors focus-visible:outline-none',
  {
    variants: {
      intent: {
        ink: 'text-ink-900 hover:text-ink-700',
        gold: 'text-gold-700 hover:text-gold-800',
        muted: 'text-ink-500 hover:text-ink-900',
        inverse: 'text-cream-50 hover:text-gold-300',
      },
      underline: {
        true: 'underline underline-offset-4 hover:underline-offset-2',
        false: '',
      },
    },
    defaultVariants: { intent: 'ink', underline: false },
  },
);

type TextLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & VariantProps<typeof linkVariants>;

export function TextLink({
  className,
  intent,
  underline,
  href,
  children,
  ...props
}: TextLinkProps) {
  const isInternal = typeof href === 'string' && (href.startsWith('/') || href.startsWith('#'));
  const classNames = cn(linkVariants({ intent, underline }), className);
  if (isInternal && typeof href === 'string') {
    return (
      <Link href={href} className={classNames} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={classNames} rel="noopener noreferrer" {...props}>
      {children}
    </a>
  );
}
