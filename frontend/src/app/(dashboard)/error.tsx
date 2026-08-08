"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { Button } from "@/components/ui/button";

/**
 * The last line of defence for anything under the dashboard.
 *
 * React error boundaries have to be class components, which is why Next's
 * convention exists: this file *is* the boundary, and the framework wraps the
 * segment in one for us. Without it a render error anywhere below unmounts the
 * whole tree and leaves a blank white page with no way back.
 *
 * Scoped to the (dashboard) group deliberately — the header and the auth guard
 * live above it, so a broken page still leaves the user signed in and able to
 * navigate away.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The user gets a readable message; the details go where they are useful.
    console.error("Dashboard error boundary caught:", error);
  }, [error]);

  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <span className="mb-5 flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
        <AlertTriangle className="size-5" />
      </span>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This page hit an error it couldn&apos;t recover from on its own. Your
        videos and captions are unaffected.
      </p>

      {/* The digest is the only handle on the server-side stack trace, which
          Next deliberately withholds from the browser in production. Without
          showing it there is no way to connect a user's report to a log line. */}
      {error.digest && (
        <p className="mt-3 rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      )}

      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/dashboard" className={buttonVariants({ variant: "secondary" })}>
          Back to your videos
        </Link>
      </div>
    </main>
  );
}
