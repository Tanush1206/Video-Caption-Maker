import { cn } from "@/lib/utils";

/**
 * A placeholder shaped like the content that is coming.
 *
 * A sweeping highlight rather than a pulse. Pulsing dims the whole block on a
 * cycle, which reads as something being wrong; a sweep reads as work in
 * progress. The gradient is clipped by `overflow-hidden` and translated from
 * -100% to 100%, so nothing escapes the shape.
 *
 * The reduced-motion rule in globals.css stops the sweep, leaving a plain
 * block — still a correct placeholder, just a still one.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // Hidden from assistive tech: a screen reader should hear the loading
      // state announced once by the region, not read out a row of empty boxes.
      aria-hidden="true"
      className={cn("relative overflow-hidden rounded-md bg-muted", className)}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-foreground/[0.07] to-transparent" />
    </div>
  );
}
