"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, Search, Settings } from "lucide-react";

import { Brand } from "@/components/layout/brand";
import { EngineChip, HostChip } from "@/components/layout/engine-chip";
import { PageHeader } from "@/components/layout/page-frame";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { LOCAL_MODE } from "@/lib/config";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Projects", icon: FolderOpen },
  { href: "/search", label: "Search", icon: Search },
  { href: "/settings", label: "Settings", icon: Settings },
];

function useIsActive() {
  const pathname = usePathname();
  // startsWith, so /search/12 still lights up "Search" — but not for
  // /dashboard, which would then match everything under it. The editor is a
  // project, so it keeps "Projects" lit.
  return (href: string) =>
    href === "/dashboard"
      ? pathname === href || pathname.startsWith("/editor")
      : pathname.startsWith(href);
}

/**
 * The top bar: wordmark and address on the left, the three sections as one
 * segmented control in the middle, the hardware readout on the right. On a
 * phone the sections move to a tab bar at the bottom (MobileTabBar), where a
 * thumb can reach them.
 */
export function DashboardHeader() {
  const isActive = useIsActive();

  return (
    <PageHeader sticky wide>
      <div className="flex min-w-0 items-center gap-3">
        <Brand href="/dashboard" />
        <HostChip className="hidden lg:inline-flex" />
      </div>

      <nav
        aria-label="Sections"
        className="mx-auto hidden items-center gap-1 rounded-lg border border-border bg-card p-1 md:flex"
      >
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cn(
              "rounded-md px-3.5 py-1 text-[13px] font-medium transition-colors",
              isActive(item.href)
                ? "bg-surface-3 text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-1.5 md:ml-0">
        <EngineChip className="hidden max-w-[22rem] sm:inline-flex" />
        <ThemeToggle />
        {/* Nobody to sign out as on a local install. */}
        {!LOCAL_MODE && <UserMenu />}
      </div>
    </PageHeader>
  );
}

/** Phone navigation, fixed to the bottom edge. The layout pads for it. */
export function MobileTabBar() {
  const isActive = useIsActive();

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
    >
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(item.href) ? "page" : undefined}
          className={cn(
            "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
            isActive(item.href) ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <item.icon className="size-5" aria-hidden="true" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
