import Link from 'next/link';
import { mediaUrl } from '@/lib/media';
import { cn } from '@/lib/cn';

/**
 * The AJOOBA logo asset is the source of truth for the brand.
 *
 * `public/images/logo/logo.jpeg` is a cream wordmark on a dark field, so it
 * reads correctly on the midnight-navy header/footer without inversion. On
 * light surfaces we render the transparent gold AF mark (`logo-nobg.png`)
 * beside the wordmark typeset in the brand serif, which stays crisp at small
 * sizes and avoids a low-resolution JPEG stretching.
 */
export function Logo({
  className,
  variant = 'ink',
}: {
  className?: string;
  variant?: 'ink' | 'inverse';
}) {
  if (variant === 'inverse') {
    return (
      <Link
        href="/"
        aria-label="Ajooba Footwear — go to homepage"
        className={cn('inline-flex items-center', className)}
      >
        <img
          src={mediaUrl('/images/logo/logo.jpeg')}
          alt="Ajooba Footwear"
          height={36}
          width={140}
          className="h-9 w-auto"
          loading="eager"
          decoding="async"
        />
      </Link>
    );
  }

  return (
    <Link
      href="/"
      aria-label="Ajooba Footwear — go to homepage"
      className={cn('group/logo inline-flex items-center gap-2 leading-none', className)}
    >
      <img
        src={mediaUrl('/images/logo/logo-nobg.png')}
        alt="Ajooba Footwear logo"
        width={40}
        height={40}
        className="h-9 w-9 shrink-0 object-contain transition-transform duration-300 ease-out group-hover/logo:scale-105 md:h-10 md:w-10"
        loading="eager"
        decoding="async"
      />
      <span className="inline-flex items-baseline gap-2">
        <span className="font-display text-xl font-semibold tracking-[0.18em] text-ink-900">
          AJOOBA
        </span>
        <span className="hidden text-[0.6rem] uppercase tracking-[0.3em] text-ink-500 sm:inline">
          Footwear
        </span>
      </span>
    </Link>
  );
}
