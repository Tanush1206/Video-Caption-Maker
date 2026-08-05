"use client";

import { cn } from "@/lib/utils";

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Field({ label, error, id, className, ...props }: FieldProps) {
  const inputId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, "-");
  const errorId = `${inputId}-error`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={Boolean(error)}
        // Points screen readers at the message instead of leaving the field
        // marked invalid with no explanation.
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "w-full rounded-md border bg-background px-3 py-2 text-sm transition",
          "focus:outline-none focus:ring-2 focus:ring-primary/40",
          error ? "border-red-500" : "border-border",
          className
        )}
        {...props}
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
