"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { DashboardHeader } from "@/components/layout/dashboard-header";
import { TopGlow } from "@/components/layout/page-frame";
import { ServerUnavailable } from "@/components/layout/server-unavailable";
import { useAuth } from "@/hooks/use-auth";
import { useTranscriptionAlerts } from "@/hooks/use-transcription-alerts";
import { LOCAL_MODE } from "@/lib/config";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, initialized, bootstrap } = useAuth();

  // Here rather than on any one page: a transcription outlives the screen that
  // started it, and this layout is the only thing that stays mounted while the
  // user moves around. It no-ops until something is actually being watched.
  useTranscriptionAlerts();

  useEffect(() => {
    // Wait for the bootstrap refresh to settle. Redirecting before it does
    // would bounce every signed-in user to /login on a page reload, since the
    // access token only lives in memory.
    // A local install has no login to send anyone to.
    if (initialized && !isAuthenticated && !LOCAL_MODE) {
      router.replace("/login");
    }
  }, [initialized, isAuthenticated, router]);

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // Render nothing while the redirect above is in flight, so protected
  // content never flashes on screen for a signed-out visitor.
  if (!isAuthenticated) {
    // Locally the session is handed out unconditionally, so failing to get
    // one means the server is unreachable — say that, and keep trying.
    return LOCAL_MODE ? <ServerUnavailable onRetry={() => void bootstrap()} /> : null;
  }

  return (
    // `relative isolate` so the glow can position against this and stay behind
    // the content. Deliberately *not* overflow-hidden — that would make the
    // sticky header stop sticking. The glow clips itself instead.
    <div className="relative isolate min-h-screen">
      <TopGlow />
      <DashboardHeader />
      {children}
    </div>
  );
}
