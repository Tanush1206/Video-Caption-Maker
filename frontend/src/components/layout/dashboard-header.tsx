"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Film, Search, Settings } from "lucide-react";

import { Brand } from "@/components/layout/brand";
import { PageHeader } from "@/components/layout/page-frame";
import { UserMenu } from "@/components/layout/user-menu";
import { LOCAL_MODE } from "@/lib/config";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Videos", icon: Film },
  { href: "/search", label: "Search", icon: Search },
  { href: "/settings", label: "Settings", icon: Settings },
];

function useIsActive() {
  const pathname = usePathname();
  // startsWith, so /search/12 still lights up "Search" — but not for
  // /dashboard, which would then match everything under it. The editor is a
  // video, so it keeps "Videos" lit.
  return (href: string) =>
    href === "/dashboard"
      ? pathname === href || pathname.startsWith("/editor")
      : pathname.startsWith(href);
}

/**
 * The top bar: the app's name on the left and the three sections as plain
 * text tabs, on a translucent bar. Nothing else: the hardware readout and the
 * theme live in Settings (v1.1.0). On a phone the sections move to a tab bar
 * at the bottom (MobileTabBar), where a thumb can reach them.
 */
export function DashboardHeader() {
  const isActive = useIsActive();
  const pathname = usePathname();

  return (
    // On a phone the editor's own bar (back, title, Export) is enough.
    <PageHeader sticky wide className={cn(pathname.startsWith("/editor") && "max-md:hidden")}>
      <Brand href="/dashboard" />

      {/* Centred in the bar, independent of the name's width. */}
      <nav
        aria-label="Sections"
        className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex"
      >
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors duration-200 ease-out",
              isActive(item.href)
                ? "font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Nobody to sign out as on a local install. */}
      {!LOCAL_MODE && (
        <div className="ml-auto flex items-center">
          <UserMenu />
        </div>
      )}
    </PageHeader>
  );
}

/** Phone navigation, fixed to the bottom edge. The layout pads for it. */
export function MobileTabBar() {
  const isActive = useIsActive();
  const pathname = usePathname();
  // The editor has its own bottom sheet (the inspector).
  if (pathname.startsWith("/editor")) return null;

  return (
    <nav
      aria-label="Sections"
      className="bar-translucent fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(item.href) ? "page" : undefined}
          className={cn(
            "flex min-h-12 flex-col items-center justify-center gap-0.5 py-1.5 text-2xs font-medium transition-colors duration-200 ease-out",
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
