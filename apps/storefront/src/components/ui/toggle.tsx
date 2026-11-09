'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, description, id, ...props },
  ref,
) {
  const inputId = id ?? `cb-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <label
      htmlFor={inputId}
      className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-ink-50"
    >
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className={cn(
          'mt-0.5 h-4 w-4 rounded border-ink-300 accent-ink-900 focus-visible:outline-none',
          className,
        )}
        {...props}
      />
      <span className="text-sm leading-tight">
        <span className="block font-medium text-ink-900">{label}</span>
        {description ? <span className="block text-xs text-ink-500">{description}</span> : null}
      </span>
    </label>
  );
});

interface RadioProps {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  label: string;
  description?: string;
  className?: string;
  disabled?: boolean;
}

export function Radio({
  name,
  value,
  checked,
  onChange,
  label,
  description,
  className,
  disabled = false,
}: RadioProps) {
  const id = `rd-${name}-${value}`.replace(/[^a-z0-9-]/gi, '-');
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md px-3 py-2 hover:bg-ink-50',
        disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent',
        checked && 'bg-ink-50',
        className,
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-0.5 h-4 w-4 border-ink-300 accent-ink-900 focus-visible:outline-none"
      />
      <span className="text-sm leading-tight">
        <span className="block font-medium text-ink-900">{label}</span>
        {description ? <span className="block text-xs text-ink-500">{description}</span> : null}
      </span>
    </label>
  );
}
