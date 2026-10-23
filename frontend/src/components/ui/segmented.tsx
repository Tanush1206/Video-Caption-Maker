"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface Segment<T> {
  value: T;
  label: string;
  /** Icon-only segments still carry `label` as their accessible name. */
  icon?: LucideIcon;
}

/**
 * A segmented control (v1.1.0): one grey track, the chosen segment lifted on
 * a white (dark: grey) fill. 8 px radius. Labels stay the main text colour
 * in every segment: the secondary grey is under AA on the track.
 *
 * `kind="pressed"` keeps the toggle-button semantics the library's filters
 * always had (a group of buttons with aria-pressed); `kind="radio"` is one
 * setting with several values, and arrow keys move between them.
 */
export function Segmented<T extends string | number | null>({
  segments,
  value,
  onChange,
  label,
  kind = "pressed",
  iconOnly = false,
  className,
  segmentClassName,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The control's accessible name. */
  label: string;
  kind?: "pressed" | "radio";
  iconOnly?: boolean;
  className?: string;
  segmentClassName?: string;
}) {
  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (kind !== "radio") return;
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = segments[(index + step + segments.length) % segments.length];
    onChange(next.value);
    const buttons = (event.currentTarget.parentElement?.querySelectorAll("button") ?? []) as NodeListOf<HTMLButtonElement>;
    buttons[(index + step + segments.length) % segments.length]?.focus();
  }

  return (
    <div
      role={kind === "radio" ? "radiogroup" : "group"}
      aria-label={label}
      className={cn("flex rounded-md bg-surface-3 p-0.5", className)}
    >
      {segments.map((segment, index) => {
        const selected = segment.value === value;
        const Icon = segment.icon;
        return (
          <button
            key={String(segment.value)}
            type="button"
            role={kind === "radio" ? "radio" : undefined}
            aria-checked={kind === "radio" ? selected : undefined}
            aria-pressed={kind === "pressed" ? selected : undefined}
            aria-label={iconOnly ? segment.label : undefined}
            title={iconOnly ? segment.label : undefined}
            tabIndex={kind === "radio" && !selected ? -1 : undefined}
            onClick={() => onChange(segment.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 text-sm text-foreground sm:min-h-7",
              "transition-colors duration-200 ease-out",
              selected ? "bg-segment font-medium" : "hover:bg-background/40",
              segmentClassName
            )}
          >
            {Icon && <Icon className="size-4" aria-hidden="true" />}
            {!iconOnly && segment.label}
          </button>
        );
      })}
    </div>
  );
}
