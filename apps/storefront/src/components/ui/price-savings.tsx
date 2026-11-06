import { cn } from '@/lib/cn';
import { discountPercent, hasDiscount, rupees } from '@/lib/format';

/** A consistent, plain-language display of savings computed from existing prices. */
export function PriceSavings({
  mrp,
  sellingPrice,
  className,
}: {
  mrp: number;
  sellingPrice: number;
  className?: string;
}) {
  if (!hasDiscount(mrp, sellingPrice)) return null;

  const amount = mrp - sellingPrice;
  const percent = discountPercent(mrp, sellingPrice);

  return (
    <p className={cn('tnum step-xs font-medium text-gold-800', className)}>
      Save {rupees(amount)} <span aria-hidden="true">·</span> {percent}% off
    </p>
  );
}
