"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { AppFooter } from "@/components/layout/app-footer";
import { DashboardHeader, MobileTabBar } from "@/components/layout/dashboard-header";
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
  const pathname = usePathname();
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
    // The bottom padding on phones is the tab bar's height, so the last row
    // of any page can scroll clear of it.
    <div className="flex min-h-screen flex-col pb-16 md:pb-0">
      <DashboardHeader />
      {children}
      {/* The editor is a full-height workspace; a footer would only push its
          panels down. */}
      {!pathname.startsWith("/editor") && <AppFooter />}
      <MobileTabBar />
    </div>
  );
}
