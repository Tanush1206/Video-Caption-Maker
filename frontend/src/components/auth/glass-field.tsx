"use client";

import type { LucideIcon } from "lucide-react";
import { forwardRef, useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The pill-shaped glass input and its matching round button.
 *
 * Both are the same material — see `.glass-surface` in globals.css — so the
 * styling lives there and these components only arrange content on top of it.
 *
 * Two departures from the 21st.dev original:
 *
 * **The label is real.** The original identified its fields by placeholder
 * alone, with a floating label that appeared only once you had typed. A
 * placeholder is not a label: it is announced inconsistently, and it vanishes
 * exactly when a screen reader user would want to re-read it. Here every
 * field has a `<label>` bound by id, visually hidden until there is a value
 * and then shown in the same floating position.
 *
 * **The button is a button.** The original wrapped its `<button>` in a
 * `<div onClick>` that queried for the button and re-dispatched a click. That
 * div was not focusable, had no role, and double-fired inside a form. The
 * element here is the button.
 */

interface GlassFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon: LucideIcon;
  /** Rendered inside the pill, on the right. Collapses to zero width when absent. */
  action?: React.ReactNode;
  /** Swaps the leading icon — used for the password reveal toggle. */
  leading?: React.ReactNode;
  /** Show the floating label. Callers pass `Boolean(value)`. */
  labelVisible?: boolean;
  error?: string;
}

export const GlassField = forwardRef<HTMLInputElement, GlassFieldProps>(
  function GlassField(
    { label, icon: Icon, action, leading, labelVisible, error, className, id, ...props },
    ref
  ) {
    const generated = useId();
    const inputId = id ?? generated;
    const errorId = `${inputId}-error`;

    return (
      <div className="relative w-full">
        <label
          htmlFor={inputId}
          className={cn(
            "absolute -top-6 left-4 z-10 text-xs font-semibold transition-opacity duration-300",
            error ? "text-destructive" : "text-muted-foreground",
            // Hidden visually, never from assistive tech.
            labelVisible || error ? "opacity-100" : "sr-only"
          )}
        >
          {label}
        </label>

        <div
          className={cn(
            "glass-surface flex w-full items-center gap-2 p-1",
            error && "ring-2 ring-destructive/60",
            className
          )}
        >
          <span className="glass-sheen" aria-hidden="true" />

          <span className="relative z-10 flex size-10 shrink-0 items-center justify-center">
            {leading ?? <Icon className="size-5 text-foreground/80" aria-hidden="true" />}
          </span>

          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              "relative z-10 h-10 w-0 flex-grow bg-transparent text-foreground",
              "placeholder:text-foreground/60 focus:outline-none",
              "disabled:cursor-not-allowed"
            )}
            {...props}
          />

          {/* Width, not conditional rendering: an element that unmounts takes
              focus with it, and this button is what the user just tabbed to. */}
          <span
            className={cn(
              "relative z-10 shrink-0 overflow-hidden transition-[width] duration-300 ease-out",
              action ? "w-11 pr-1" : "w-0"
            )}
          >
            {action}
          </span>
        </div>

        {error && (
          <p id={errorId} role="alert" className="mt-2 pl-4 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }
);

export const GlassIconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function GlassIconButton({ className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "glass-surface flex size-10 items-center justify-center text-foreground/80",
        "transition-colors hover:text-foreground disabled:opacity-40",
        className
      )}
      {...props}
    >
      <span className="glass-sheen" aria-hidden="true" />
      <span className="relative z-10 flex items-center justify-center">{children}</span>
    </button>
  );
});

/** Shared by the two wide pills below, so they stay the same object. */
const PILL = cn(
  "glass-surface flex w-full items-center justify-center gap-2.5 px-5 py-3",
  "text-sm font-semibold text-foreground disabled:opacity-60"
);

/**
 * The wide pill as a link — used for the OAuth provider, which has to be a
 * real navigation rather than a fetch.
 */
export const GlassLink = forwardRef<
  HTMLAnchorElement,
  React.AnchorHTMLAttributes<HTMLAnchorElement>
>(function GlassLink({ className, children, ...props }, ref) {
  return (
    <a ref={ref} className={cn(PILL, className)} {...props}>
      <span className="glass-sheen" aria-hidden="true" />
      <span className="relative z-10 flex items-center gap-2.5">{children}</span>
    </a>
  );
});

/** The wide pill as a submit button. */
export const GlassSubmit = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function GlassSubmit({ className, children, ...props }, ref) {
  return (
    <button ref={ref} className={cn(PILL, className)} {...props}>
      <span className="glass-sheen" aria-hidden="true" />
      <span className="relative z-10 flex items-center gap-2.5">{children}</span>
    </button>
  );
});
