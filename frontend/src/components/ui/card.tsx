import { cn } from "@/lib/utils";

/**
 * A raised surface.
 *
 * `bg-card` rather than `bg-background`: in dark they differ — the card is
 * lifted off the page by lightness, because a shadow on a near-black surface
 * is invisible. In light they are the same colour and the border plus shadow
 * do the separating. One class expresses "this is a surface" in both.
 */
export function Card({
  className,
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground shadow-sm",
        interactive &&
          cn(
            "transition-all duration-200 ease-out",
            // Lifting on hover reads as "this is clickable" without needing a
            // cursor change to say so. It also brightens a step, which is how
            // the dark theme expresses elevation at all.
            "hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-card",
            // Keyboard users get the same affordance as the mouse.
            "focus-within:-translate-y-0.5 focus-within:shadow-card"
          ),
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1 p-4 sm:p-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold", className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // pt-0 by default: the header already paid for the space above.
  return <div className={cn("p-4 pt-0 sm:p-5 sm:pt-0", className)} {...props} />;
}
