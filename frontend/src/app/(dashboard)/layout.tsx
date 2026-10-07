"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { DashboardHeader } from "@/components/layout/dashboard-header";
import { TopGlow } from "@/components/layout/page-frame";
import { useAuth } from "@/hooks/use-auth";
import { useTranscriptionAlerts } from "@/hooks/use-transcription-alerts";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, initialized } = useAuth();

  // Here rather than on any one page: a transcription outlives the screen that
  // started it, and this layout is the only thing that stays mounted while the
  // user moves around. It no-ops until something is actually being watched.
  useTranscriptionAlerts();

  useEffect(() => {
    // Wait for the bootstrap refresh to settle. Redirecting before it does
    // would bounce every signed-in user to /login on a page reload, since the
    // access token only lives in memory.
    if (initialized && !isAuthenticated) {
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
  if (!isAuthenticated) return null;

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
