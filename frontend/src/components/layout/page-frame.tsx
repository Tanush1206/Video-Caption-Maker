import { cn } from "@/lib/utils";

/**
 * The geometry every page agrees on.
 *
 * These three screens had drifted into three different frames: the landing
 * header was 64px tall in a `px-6` container, the auth header about 72px in no
 * container at all, and the dashboard 56px in `px-4 sm:px-6`. Signing in
 * moved the brand mark both down and sideways, which is the kind of thing
 * nobody reports and everybody feels.
 *
 * 56px wins because it was already the canonical value — `spacing.header` in
 * the Tailwind config, which the editor layout subtracts in `calc()`.
 */

/** One container. Every full-width page uses this and nothing else. */
export const CONTAINER = "mx-auto w-full max-w-6xl px-4 sm:px-6";

export function PageHeader({
  sticky = false,
  className,
  children,
  below,
}: {
  /** Sticky, bordered and blurred — for the signed-in app, which scrolls. */
  sticky?: boolean;
  className?: string;
  children: React.ReactNode;
  /** Rendered full-width under the bar. The mobile nav drawer lives here. */
  below?: React.ReactNode;
}) {
  return (
    <header
      className={cn(
        "z-40 w-full",
        sticky && [
          "sticky top-0 border-b border-border",
          // Translucent with a blur, so content scrolling underneath stays
          // faintly visible instead of vanishing behind an opaque bar. The
          // supports check keeps a solid fallback where blur is unavailable,
          // rather than leaving the header see-through and unreadable.
          "bg-background/85",
          "supports-[backdrop-filter]:bg-background/70",
          "supports-[backdrop-filter]:backdrop-blur-lg",
        ],
        className
      )}
    >
      <div className={cn(CONTAINER, "flex h-header items-center gap-4")}>{children}</div>
      {below}
    </header>
  );
}

/**
 * The quiet version of the landing page's backdrop.
 *
 * Same two tokens and the same technique as the hero and the auth screens, at
 * a fraction of the intensity. That difference is deliberate rather than a
 * compromise: a landing page is asking for attention and a tool is being used
 * for hours, so matching the hero's wash here would be the wrong kind of
 * consistency. What carries across is the palette, not the volume.
 *
 * The parent needs `relative isolate` — and must *not* be `overflow-hidden`,
 * which would break the sticky header. The clipping happens on this element
 * instead.
 */
export function TopGlow() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 overflow-hidden"
    >
      <div className="absolute -top-40 left-1/2 h-80 w-[52rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className="absolute -top-24 right-0 h-56 w-72 rounded-full bg-accent/10 blur-3xl" />
    </div>
  );
}
