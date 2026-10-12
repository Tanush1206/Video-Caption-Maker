"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * A modal on the native <dialog>: showModal() gives the focus trap, Escape,
 * the inert page behind and the top layer, so none of that is rebuilt here.
 * Closing by Escape or the backdrop reports through onClose, so the parent's
 * `open` stays the one source of truth.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
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
        "m-auto max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-4xl overflow-hidden rounded-lg border border-border bg-card p-0 text-foreground shadow-overlay",
        "backdrop:bg-black/60 backdrop:backdrop-blur-sm",
        className
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100vh-2rem)] flex-col">
          <header className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4 sm:px-7 sm:py-5">
            {icon && (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-primary">
                {icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 id="dialog-title" className="text-lg font-semibold tracking-tight">
                {title}
              </h2>
              {description && <div className="mt-0.5 text-[13px] text-muted-foreground">{description}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">{children}</div>
          {footer && (
            <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border px-5 py-4 sm:px-7">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
