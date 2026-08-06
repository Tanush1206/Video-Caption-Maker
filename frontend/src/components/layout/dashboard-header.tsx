"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";

export function DashboardHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/dashboard" className="font-semibold">
          VideoCaptionMaker
        </Link>

        <div className="flex items-center gap-4">
          {/* pr-12 keeps this clear of the fixed theme toggle in the corner. */}
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {user?.full_name || user?.email}
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            className="mr-12 flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
