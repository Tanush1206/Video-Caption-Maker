"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface MenuItem {
  label: string;
  /** A link, or an action; one of the two. */
  href?: string;
  onSelect?: () => void;
  /** Red text: the way into a destructive flow. */
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * A "…" button and the small menu it opens (v1.1.0): actions that don't need
 * to be on screen all the time. Floating, so it is the one place with a
 * shadow. Arrow keys move between items, Escape and a click outside close
 * it, and focus goes back to the button.
 */
export function Menu({
  label,
  items,
  className,
  align = "end",
}: {
  /** The button's accessible name, e.g. "More actions for clip.mp4". */
  label: string;
  items: MenuItem[];
  className?: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus();

    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const entries = Array.from(
      list.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? []
    );
    const at = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      entries[(at + 1) % entries.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      entries[(at - 1 + entries.length) % entries.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  const itemClass = (item: MenuItem) =>
    cn(
      "flex min-h-11 w-full items-center rounded-md px-3 text-left text-[15px] outline-none sm:min-h-8 sm:text-sm",
      "transition-colors duration-150 ease-out focus-visible:ring-0",
      item.destructive ? "text-destructive" : "text-foreground",
      item.disabled
        ? "pointer-events-none opacity-40"
        : "hover:bg-surface-3 focus:bg-surface-3"
    );

  return (
    <div ref={container} className={cn("relative", className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out sm:size-8",
          "hover:bg-surface-2 hover:text-foreground",
          open && "bg-surface-2 text-foreground"
        )}
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={cn(
            "absolute top-full z-50 mt-1 min-w-48 animate-fade-in rounded-xl border border-border/60 p-1 shadow-overlay",
            "bg-background/95 backdrop-blur-xl dark:bg-surface-3/95",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          {items.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                onClick={() => setOpen(false)}
                className={itemClass(item)}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={itemClass(item)}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
