"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A button and the small floating panel it opens (v1.1.0): the volume
 * slider, the speed list. Floating, so it has the one shadow. Escape and a
 * click outside close it, and focus goes back to the button. `children`
 * gets `close` so a choice inside can dismiss it.
 *
 * `panelLabel` (v1.2.1) is for a panel that only says something, like the
 * caption accuracy note: it becomes a labelled dialog, described by its
 * text, and takes the focus itself, so a screen reader reads it out when it
 * opens.
 */
export function Popover({
  label,
  trigger,
  children,
  side = "top",
  align = "end",
  className,
  triggerClassName,
  panelClassName,
  panelLabel,
}: {
  /** The button's accessible name. */
  label: string;
  /** What the button shows: an icon, or "1×". */
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "end";
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  /** Makes the panel a dialog with this name, focused when it opens. */
  panelLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  // Kept 16 px inside the window, before it paints: a panel opened from a
  // button mid-line on a phone (the accuracy note beside "Spoken audio")
  // otherwise ran off the right edge.
  useLayoutEffect(() => {
    const panel = container.current?.querySelector<HTMLElement>("[data-popover-panel]");
    if (!open || !panel) return;
    const { left, right } = panel.getBoundingClientRect();
    const margin = 16;
    const shift = Math.max(margin - left, Math.min(0, window.innerWidth - margin - right));
    panel.style.translate = shift ? `${shift}px 0` : "";
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const panel = container.current?.querySelector<HTMLElement>("[data-popover-panel]");
    (panel?.querySelector<HTMLElement>("input, button") ?? (panelLabel ? panel : null))?.focus();

    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, panelLabel]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  return (
    <div
      ref={container}
      className={cn("relative", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex size-11 items-center justify-center rounded-full text-foreground transition-colors duration-200 ease-out hover:bg-surface-3 sm:size-9",
          open && "bg-surface-3",
          triggerClassName
        )}
      >
        {trigger}
      </button>

      {open && (
        <div
          id={id}
          data-popover-panel=""
          {...(panelLabel && {
            role: "dialog",
            "aria-label": panelLabel,
            "aria-describedby": `${id}-body`,
            tabIndex: -1,
          })}
          className={cn(
            "absolute z-50 animate-fade-in rounded-xl border border-border/60 p-2 shadow-overlay",
            "bg-background/95 backdrop-blur-xl dark:bg-surface-3/95",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
            align === "end" ? "right-0" : "left-0",
            panelClassName
          )}
        >
          {panelLabel ? <div id={`${id}-body`}>{children(close)}</div> : children(close)}
        </div>
      )}
    </div>
  );
}
