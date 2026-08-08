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
      className={cn("group flex shrink-0 items-center gap-2.5", className)}
      aria-label="VideoCaptionMaker home"
    >
      <span className="relative flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent shadow-sm transition-transform duration-200 ease-out group-hover:scale-105">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="size-[18px] text-primary-foreground"
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
        <span className="text-[15px] font-semibold tracking-tight">
          VideoCaption<span className="text-muted-foreground">Maker</span>
        </span>
      )}
    </Link>
  );
}
