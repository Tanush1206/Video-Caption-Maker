import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The wordmark and its glyph.
 *
 * The mark is inline SVG rather than an icon-font glyph or an image: it has to
 * be crisp at 28px, recolour with the theme, and never cause a layout shift
 * while a network request resolves.
 */
export function Brand({
  href = "/",
  className,
  showText = true,
}: {
  href?: string;
  className?: string;
  showText?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn("group flex shrink-0 items-center gap-2 rounded-md", className)}
      aria-label="VideoCaptionMaker home"
    >
      {/* The glyph alone, in the text colour: the accent is kept for the
          screen's one primary action. Shown only without the wordmark. */}
      <span className={cn("relative flex size-6 items-center justify-center", showText && "hidden")}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="size-5 text-foreground"
          aria-hidden="true"
        >
          {/* A frame with two caption lines inside it — the whole product in
              one glyph. Stroke-based so it stays even at small sizes. */}
          <rect
            x="2.5"
            y="4.5"
            width="19"
            height="15"
            rx="3"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M6.5 14h4M12.5 14h5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M6.5 10.5h2.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.6"
          />
        </svg>
      </span>

      {showText && (
        <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">VideoCaptionMaker</span>
      )}
    </Link>
  );
}
