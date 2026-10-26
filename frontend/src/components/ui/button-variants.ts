import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Button styling, deliberately in its own module with **no "use client"**.
 *
 * This started out inside button.tsx and broke the production build. A
 * `"use client"` file does not export values to the server — Next replaces
 * each export with a client *reference*, so a server component importing
 * `buttonVariants` receives an object and calling it throws
 * `TypeError: (0, o.d) is not a function`. It only shows up at build time,
 * during prerender; `next dev` renders those pages on demand and never hits it.
 *
 * Splitting the styles out means anchors styled as buttons work in server
 * components (the landing page, the dashboard header, not-found) while the
 * interactive Button stays a client component.
 */
export const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap",
    "rounded-lg font-medium transition-[background-color,color,opacity] duration-200 ease-out",
    // Pointer events off while disabled, so a disabled submit cannot swallow a
    // click and look merely unresponsive.
    "disabled:pointer-events-none disabled:opacity-40",
    // Icons are sized by the button rather than at each call site, and never
    // shrink when the label wraps.
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
  ),
  {
    variants: {
      variant: {
        // The one action a screen is for: at most one per screen.
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover",
        // Everything else that needs a shape: a light grey fill, no border.
        secondary: "bg-surface-3 text-foreground hover:bg-surface-3/70 active:bg-surface-3/50",
        // Plain accent text: the quiet secondary action.
        plain: "text-primary hover:bg-surface-2 active:bg-surface-3",
        // Grey icon buttons and tools.
        ghost: "text-muted-foreground hover:bg-surface-2 hover:text-foreground active:bg-surface-3",
        // Filled red: only inside the confirm dialog of a destructive action.
        destructive:
          "bg-destructive-fill text-destructive-foreground hover:bg-destructive-fill/90 active:bg-destructive-fill/80",
        // The way *into* a destructive flow: red text, nothing filled.
        danger: "text-destructive hover:bg-destructive/10 active:bg-destructive/15",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // 44 px on a phone (the minimum touch target), desktop sizes from sm up.
      size: {
        sm: "h-11 px-3 text-sm sm:h-8",
        md: "h-11 px-4 text-[15px] sm:h-9",
        lg: "h-11 px-5 text-[15px]",
        icon: "size-11 sm:size-9",
        "icon-sm": "size-11 sm:size-8 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
