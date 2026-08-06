"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { DashboardHeader } from "@/components/layout/dashboard-header";
import { useAuth } from "@/hooks/use-auth";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, initialized } = useAuth();

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
    <div className="min-h-screen">
      <DashboardHeader />
      {children}
    </div>
  );
}
