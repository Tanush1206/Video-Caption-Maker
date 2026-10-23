import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export const FLOW_STEPS = ["Upload", "Language", "Export"] as const;

/**
 * Where you are in Upload → Language → Export.
 *
 * An ordered list, so a screen reader announces "step 2 of 3" from the markup
 * alone; `aria-current="step"` marks the live one. Steps before `current` are
 * done, steps after it are still ahead.
 */
export function Stepper({ current, className }: { current: 1 | 2 | 3 | 4; className?: string }) {
  return (
    <ol className={cn("flex min-w-0 items-center gap-2 sm:gap-3", className)} aria-label="Progress">
      {FLOW_STEPS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li key={label} className="flex min-w-0 items-center gap-2 sm:gap-3">
            {index > 0 && <span aria-hidden="true" className="h-px w-4 shrink-0 bg-border sm:w-6" />}
            <span
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-1.5 text-sm",
                active ? "font-semibold text-foreground" : "text-muted-foreground"
              )}
            >
              {done ? (
                <Check className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 shrink-0 rounded-full", active ? "bg-accent" : "bg-muted-foreground/50")}
                />
              )}
              <span className="truncate">
                {label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
