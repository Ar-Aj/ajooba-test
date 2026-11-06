'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CheckoutStep {
  id: string;
  title: string;
  summary?: string;
  content: ReactNode;
}

/**
 * The checkout stepper.
 *
 * ## One step open at a time, and the completed ones stay legible
 *
 * A checkout that reveals all four forms at once is a wall. This shows the
 * current step open, every completed step collapsed to its one-line summary, and
 * the steps ahead as names only. So a shopper can see both where they are and
 * what is left, which is the question they actually have at step two.
 *
 * ## Not a form
 *
 * Deliberately not a `<form>` — the steps are separate validation units, and one
 * form with hidden fields is far harder to make correct and accessible. Each
 * step owns its own submit and reports its own errors via `role="alert"`.
 *
 * ## The progress mark
 *
 * A filled ink block for the current step, a small ink tick for a completed one,
 * and an outline numeral for what remains. The tick is the only place in the
 * storefront that uses a success glyph, and it replaces a green circle: claret
 * is for faults and gold is an accent, so neither is available for "done".
 */
export function CheckoutSteps({
  steps,
  currentStep,
  completedSteps,
  onStepChange,
}: {
  steps: CheckoutStep[];
  currentStep: string;
  completedSteps: string[];
  onStepChange: (id: string) => void;
}) {
  return (
    <ol className="border-t border-border">
      {steps.map((step, index) => {
        const isCurrent = step.id === currentStep;
        const isDone = completedSteps.includes(step.id);
        const isOpen = isCurrent || isDone;

        return (
          <li key={step.id} className="border-b border-border">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => onStepChange(step.id)}
                aria-current={isCurrent ? 'step' : undefined}
                aria-expanded={isOpen}
                className="flex min-w-0 flex-1 items-center gap-4 py-4 text-left"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'tnum step-xs inline-flex h-6 w-6 shrink-0 items-center justify-center',
                    isCurrent
                      ? 'bg-ink-900 text-cream-50'
                      : isDone
                        ? 'bg-ink-900/10 text-ink-800'
                        : 'border border-border text-ink-400',
                  )}
                >
                  {isDone && !isCurrent ? '✓' : index + 1}
                </span>

                <span className="min-w-0">
                  <span
                    className={cn(
                      'step-md block',
                      isCurrent ? 'text-ink-950' : isDone ? 'text-ink-800' : 'text-ink-400',
                    )}
                  >
                    {step.title}
                  </span>
                  {step.summary ? (
                    <span className="step-xs mt-0.5 block truncate text-ink-500">
                      {step.summary}
                    </span>
                  ) : null}
                </span>

                {!isCurrent && isDone ? (
                  <span className="step-xs ml-auto shrink-0 text-ink-500 underline underline-offset-4">
                    Edit
                  </span>
                ) : null}
              </button>
            </div>

            {isCurrent ? <div className="pb-7 pl-10">{step.content}</div> : null}
          </li>
        );
      })}
    </ol>
  );
}
