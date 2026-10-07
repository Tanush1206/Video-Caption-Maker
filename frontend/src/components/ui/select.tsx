"use client";

import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";

import { inputClasses } from "@/components/ui/field";
import { cn } from "@/lib/utils";

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  /** Rendered as a visible <label>. Omit only when something else labels it. */
  label?: string;
  hint?: string;
  /** "sm" for dense panels; matches the small button height. */
  size?: "sm" | "md";
}

/**
 * A native select in the same skin as every other input.
 *
 * Native on purpose: it is keyboard- and screen-reader-complete on every
 * platform, and on a phone it opens the system picker, which no custom
 * dropdown matches. Only the chrome is ours.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, id, className, size = "md", children, ...props },
  ref
) {
  const selectId = id ?? props.name;
  const hintId = hint && selectId ? `${selectId}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={selectId} className="block text-sm font-medium">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-describedby={hintId}
          className={cn(
            inputClasses,
            "cursor-pointer appearance-none pr-8",
            size === "sm" && "h-8 text-body-sm",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
});
