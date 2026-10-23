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

/** One container. Side margins 16 px on a phone, 32 px from sm up. */
export const CONTAINER = "mx-auto w-full max-w-6xl px-4 sm:px-8";

/** The editor's frame: wider, because it is a workspace rather than a page. */
export const WIDE_CONTAINER = "mx-auto w-full max-w-[1800px] px-4 sm:px-8";

export function PageHeader({
  sticky = false,
  className,
  children,
  below,
  wide = false,
}: {
  /** Sticky, bordered and blurred — for the signed-in app, which scrolls. */
  sticky?: boolean;
  /** Match the editor's wider frame, so the logo lines up with its content. */
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
  /** Rendered full-width under the bar. The mobile nav drawer lives here. */
  below?: React.ReactNode;
}) {
  return (
    <header
      className={cn(
        "z-40 w-full",
        // Translucent with a blur (.bar-translucent: 72%, blur 20 px,
        // saturate 180%), so content scrolling underneath stays faintly
        // visible; solid where blur is unavailable. A hairline below.
        sticky && "bar-translucent sticky top-0 border-b border-border",
        className
      )}
    >
      <div className={cn(wide ? WIDE_CONTAINER : CONTAINER, "relative flex h-header items-center gap-4")}>
        {children}
      </div>
      {below}
    </header>
  );
}
