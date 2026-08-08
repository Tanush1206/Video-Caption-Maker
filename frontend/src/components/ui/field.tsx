"use client";

import { forwardRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared input styling, so every form field agrees on height, radius and
 * focus treatment. Use this directly for a bare input; use Field when it
 * needs a label and error message.
 */
export const inputClasses = cn(
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm",
  "transition-colors placeholder:text-muted-foreground/70",
  "hover:border-muted-foreground/40",
  "disabled:cursor-not-allowed disabled:opacity-50"
);

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  /** Guidance shown under the label — replaced by the error when there is one. */
  hint?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, id, className, ...props },
  ref
) {
  const inputId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, "-");
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>

      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error)}
        // Points screen readers at the message instead of leaving the field
        // marked invalid with no explanation.
        aria-describedby={message ? messageId : undefined}
        className={cn(
          inputClasses,
          // Colour alone can't carry the error state — the message below does
          // that — but it's what makes the field findable in a long form.
          error && "border-destructive focus-visible:ring-destructive/50",
          className
        )}
        {...props}
      />

      {message && (
        <p
          id={messageId}
          // Only errors are announced. A hint is already reachable through
          // aria-describedby; interrupting the user to read it would be noise.
          role={error ? "alert" : undefined}
          className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}
        >
          {message}
        </p>
      )}
    </div>
  );
});
