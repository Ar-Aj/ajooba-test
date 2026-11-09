'use client';

import { useEffect } from 'react';
import { ErrorPanel } from '@/components/ui/empty-states';
import { Button } from '@/components/ui/button';

/**
 * Route-level error boundary.
 *
 * The `reset` callback re-renders the segment, which re-runs the server
 * component. That is the right recovery for a transient catalogue failure.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error for the platform's error reporting.
    console.error(error);
  }, [error]);

  return (
    <div className="container-page py-16">
      <ErrorPanel
        title="This page didn't load"
        message="Something went wrong on our side. Please try loading the page again in a moment."
        action={
          <Button intent="primary" onClick={reset}>
            Try again
          </Button>
        }
        className="mx-auto max-w-xl"
      />
    </div>
  );
}
