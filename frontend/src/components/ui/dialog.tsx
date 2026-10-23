"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * A modal on the native <dialog>: showModal() gives the focus trap, Escape,
 * the inert page behind and the top layer, so none of that is rebuilt here.
 * Closing by Escape or the backdrop reports through onClose, so the parent's
 * `open` stays the one source of truth.
 *
 * Centred, 16 px radius, the floating shadow, over a dimmed, blurred
 * backdrop. No rules inside: the title, body and footer are separated by
 * space alone.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  bodyClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  /** Accepted from callers, not drawn: the title says what a dialog is. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** Replaces the body's padding and scrolling, for content with its own. */
  bodyClassName?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself; one inside the
      // panel lands on a child.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
      className={cn(
        "m-auto max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-4xl overflow-hidden rounded-2xl bg-background p-0 text-foreground shadow-overlay dark:bg-card",
        "backdrop:bg-black/40 backdrop:backdrop-blur-sm",
        className
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100vh-2rem)] flex-col">
          <header className="flex shrink-0 items-start gap-3 px-6 pb-2 pt-6">
            <div className="min-w-0 flex-1">
              <h2 id="dialog-title" className="text-xl font-semibold">
                {title}
              </h2>
              {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out hover:bg-surface-2 hover:text-foreground sm:size-8"
            >
              <X className="size-[18px]" />
            </button>
          </header>
          <div className={cn("min-h-0 flex-1", bodyClassName ?? "overflow-y-auto px-6 py-4")}>{children}</div>
          {footer && (
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 px-6 pb-6 pt-2">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
