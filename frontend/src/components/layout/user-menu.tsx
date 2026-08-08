"use client";

import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

/** First letters of the name, or the email's first character as a fallback. */
function initials(name: string | null | undefined, email: string | undefined) {
  if (name?.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("");
  }
  return (email?.[0] ?? "?").toUpperCase();
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Both exits, because they are different intents: Escape means "close
    // this", a click elsewhere means "I'm doing something else now". A menu
    // that only handles one of them feels stuck.
    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2 rounded-full p-0.5 pr-2 transition-colors hover:bg-muted",
          open && "bg-muted"
        )}
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
          {initials(user?.full_name, user?.email)}
        </span>
        <span className="hidden max-w-[14ch] truncate text-sm text-muted-foreground lg:block">
          {user?.full_name || user?.email}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 origin-top-right animate-fade-up overflow-hidden rounded-lg border border-border bg-card shadow-overlay"
        >
          <div className="border-b border-border px-3 py-2.5">
            {/* The name can be absent; the email never is, so it anchors the
                block and confirms which account you are about to act on. */}
            {user?.full_name && (
              <p className="truncate text-sm font-medium">{user.full_name}</p>
            )}
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>

          <div className="p-1">
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Settings className="size-4" />
              Account settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => void logout()}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
