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
    <ol className={cn("flex items-center gap-2 text-body-sm", className)} aria-label="Progress">
      {FLOW_STEPS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li key={label} className="flex min-w-0 items-center gap-2">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn("h-px w-4 shrink-0 sm:w-8", done || active ? "bg-primary/60" : "bg-border")}
              />
            )}
            <span
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-1.5",
                active ? "font-medium text-foreground" : "text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary text-primary",
                  !done && !active && "border-border"
                )}
              >
                {done ? <Check className="size-3" aria-hidden="true" /> : step}
              </span>
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
