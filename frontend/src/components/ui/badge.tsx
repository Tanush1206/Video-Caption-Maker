import { cn } from "@/lib/utils";

/**
 * A status, as a small coloured dot beside ordinary text (DESIGN_SYSTEM.md:
 * no coloured pills). The colour is on the dot only; the words carry the
 * meaning, so the dot never has to.
 */
const DOT = {
  neutral: "bg-muted-foreground",
  primary: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
} as const;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof DOT;
  dot?: boolean;
  pulse?: boolean;
}

export function Badge({ className, tone = "neutral", dot, pulse, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-sm text-muted-foreground", className)}
      {...props}
    >
      {dot && (
        <span className="relative flex size-2" aria-hidden="true">
          {pulse && (
            <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", DOT[tone])} />
          )}
          <span className={cn("relative inline-flex size-2 rounded-full", DOT[tone])} />
        </span>
      )}
      {children}
    </span>
  );
}
