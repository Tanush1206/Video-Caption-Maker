"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Film, LogOut, Menu, Search, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Brand } from "@/components/layout/brand";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
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
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-border",
        // Translucent with a blur, so content scrolling underneath stays
        // faintly visible instead of vanishing behind an opaque bar. The
        // supports check keeps a solid fallback where blur is unavailable,
        // rather than leaving the header see-through and unreadable.
        "bg-background/85 supports-[backdrop-filter]:bg-background/70 supports-[backdrop-filter]:backdrop-blur-lg"
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Brand href="/dashboard" />

        <nav className="hidden items-center gap-0.5 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                isActive(item.href)
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <div className="hidden md:block">
            <UserMenu />
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="md:hidden"
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>

      {open && (
        <nav className="animate-fade-in border-t border-border bg-card px-3 py-2 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                isActive(item.href)
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}

          <div className="mt-1 border-t border-border pt-1">
            <p className="truncate px-3 py-2 text-xs text-muted-foreground">
              {user?.full_name || user?.email}
            </p>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}
