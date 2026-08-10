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
    "rounded-md font-medium transition-colors duration-150",
    // Pointer events off while disabled, so a disabled submit cannot swallow a
    // click and look merely unresponsive.
    "disabled:pointer-events-none disabled:opacity-50",
    // Icons are sized by the button rather than at each call site, and never
    // shrink when the label wraps.
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
  ),
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        // surface-2, not card: a secondary button sits *on* a card in this
        // design and has to read as raised above it, which in dark means one
        // step lighter rather than a heavier border.
        secondary:
          "border border-border bg-surface-2 text-foreground shadow-sm hover:bg-surface-3",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        // Filled, not outlined: this is for the confirm step of a destructive
        // action, where it should be obvious which button does the damage.
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        // The way *into* a destructive flow — quiet until hovered, so "delete
        // account" isn't shouting on a settings page nobody came to use it on.
        danger: "border border-destructive/40 text-destructive hover:bg-destructive/10",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-body-sm",
        md: "h-9 px-4 text-body-md",
        lg: "h-11 px-6 text-body-md",
        // Square, for icon-only buttons. Anything smaller than this fails the
        // minimum touch target on a phone.
        icon: "size-9",
        "icon-sm": "size-8 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
