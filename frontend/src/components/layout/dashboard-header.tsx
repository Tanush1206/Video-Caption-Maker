"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Film, LogOut, Menu, Search, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Videos", icon: Film },
  { href: "/search", label: "Search", icon: Search },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function DashboardHeader() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Navigating with the menu open would leave it covering the page it just
  // moved to. Closing on the path change is simpler than wiring every link.
  useEffect(() => setOpen(false), [pathname]);

  function isActive(href: string) {
    // startsWith, so /search/12 still lights up "Search" — but not for
    // /dashboard, which would then match everything under it.
    return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  }

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-6">
          <Link href="/dashboard" className="shrink-0 font-semibold">
            VideoCaptionMaker
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition",
                  isActive(item.href)
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* mr-12 on the last item keeps it clear of the theme toggle, which is
            fixed to the top-right corner by the root layout. */}
        <div className="hidden items-center gap-4 md:flex">
          <span className="max-w-[16ch] truncate text-sm text-muted-foreground">
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

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="mr-12 rounded-md border border-border p-2 transition hover:bg-muted md:hidden"
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </div>

      {/* Opens below the header rather than as an overlay: the theme toggle is
          fixed to the top-right corner, and a full-screen panel would bury it. */}
      {open && (
        <nav className="border-t border-border px-4 py-2 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-2.5 text-sm transition",
                isActive(item.href)
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}

          <div className="mt-2 border-t border-border pt-2">
            <p className="truncate px-2 py-1 text-xs text-muted-foreground">
              {user?.full_name || user?.email}
            </p>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2.5 text-sm text-muted-foreground transition hover:bg-muted"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}
