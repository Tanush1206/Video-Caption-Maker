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
      <div className="w-full max-w-sm text-center">
        <ServerCrash className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold">Can&apos;t reach the app yet</h1>
        <p className="mt-2 text-[15px] text-muted-foreground" role="status" aria-live="polite">
          It may still be starting up. Retrying every few seconds…
        </p>
        <Button className="mt-6" onClick={onRetry}>
          Try now
        </Button>
        <p className="mt-4 text-[13px] text-muted-foreground">
          Still stuck? Run <code className="font-sans font-medium text-foreground">vcm start</code> in a
          terminal, or see Troubleshooting in the README.
        </p>
      </div>
    </main>
  );
}
