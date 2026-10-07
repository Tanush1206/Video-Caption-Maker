"use client";

import { ServerCrash } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

const RETRY_MS = 3000;

/**
 * Shown when the app's own server can't be reached.
 *
 * On a local install that almost always means it is still starting — the
 * browser opens the moment the frontend answers, and the backend may be a few
 * seconds behind. So it retries on its own rather than asking the user to
 * guess when to reload.
 */
export function ServerUnavailable({ onRetry }: { onRetry: () => void }) {
  useEffect(() => {
    const timer = window.setInterval(onRetry, RETRY_MS);
    return () => window.clearInterval(timer);
  }, [onRetry]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center shadow-sm">
        <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ServerCrash className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-base font-semibold">Can&apos;t reach the app yet</h1>
        <p className="mt-1.5 text-sm text-muted-foreground" role="status" aria-live="polite">
          It may still be starting up. Retrying every few seconds…
        </p>
        <Button className="mt-5" variant="secondary" onClick={onRetry}>
          Try now
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          Still stuck? Run <code className="rounded bg-muted px-1 py-0.5">vcm start</code> in a
          terminal, or see Troubleshooting in the README.
        </p>
      </div>
    </main>
  );
}
