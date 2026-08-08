"use client";

import { Loader2 } from "lucide-react";
import { forwardRef } from "react";

import { buttonVariants, type ButtonVariantProps } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

/**
 * Every button in the app, in one place.
 *
 * Before this, each screen hand-rolled its own `rounded-md bg-primary px-4...`
 * and they had quietly drifted: three padding scales, two disabled opacities,
 * and a delete button that looked like a submit button.
 *
 * The variant definitions live in button-variants.ts, which has no
 * "use client" — see that file for why. Import `buttonVariants` from there,
 * not from here, so a server component styling an anchor keeps working.
 */
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    ButtonVariantProps {
  /** Swaps in a spinner and disables the button. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, disabled, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      // Communicated to assistive tech as well as visually: a spinner is
      // invisible to a screen reader.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});
