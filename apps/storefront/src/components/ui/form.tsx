import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Form fields.
 *
 * A field is a line, not a box. The input has a bottom rule only, which is what
 * makes a checkout feel like a form on paper rather than a grid of rectangles.
 * The rule darkens to ink-900 on focus and to claret on error — the only two
 * states a rule can be in.
 *
 * `bg-transparent` throughout: a white input on a cream page is a box inside the
 * page, and the direction has no boxes.
 */
const fieldBase = [
  'block w-full bg-transparent text-ink-900 placeholder:text-ink-300',
  'border-0 border-b border-input px-0 py-2 text-sm',
  'transition-colors duration-150',
  'focus:border-ink-900 focus:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-[invalid=true]:border-claret-600',
].join(' ');

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type = 'text', ...props }, ref) {
    return <input ref={ref} type={type} className={cn(fieldBase, 'h-10', className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} className={cn(fieldBase, 'min-h-20 resize-y py-2', className)} {...props} />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(fieldBase, 'h-10 appearance-none pr-6', className)}
        {...props}
      >
        {children}
      </select>
    );
  },
);

type FieldProps = {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
};

/**
 * The label, the control, and one line beneath it.
 *
 * The hint and the error occupy the same slot and the error wins, so a field
 * never grows taller when it fails — which is what makes a checkout page jump
 * around when somebody submits an incomplete address.
 */
export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="block">
      <label htmlFor={htmlFor} className="label-cap block text-ink-400">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error ? (
        <p role="alert" className="step-xs mt-1.5 text-claret-700">
          {error}
        </p>
      ) : hint ? (
        <p className="step-xs mt-1.5 text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
}
