"use client";

import { cn } from "@/lib/utils";

import styles from "./range.module.css";

interface RangeProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "min" | "max"> {
  value: number;
  min: number;
  max: number;
}

/**
 * A range input that follows the palette in both themes.
 *
 * The filled proportion is handed to CSS as `--fill` because the pseudo-element
 * that draws the track cannot see the input's value — the one thing about a
 * range that stylesheets are not told. Everything else lives in the module.
 */
export function Range({ value, min, max, step = 1, className, style, ...props }: RangeProps) {
  const span = max - min;
  // Clamped, not just divided: callers legitimately pass a value outside the
  // range while data is still settling, and an unclamped fill paints past the
  // end of the track.
  const fill = span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      // A string, so nothing downstream is tempted to append a unit to it.
      style={{ ...style, "--fill": String(fill) } as React.CSSProperties}
      className={cn(styles.range, className)}
      {...props}
    />
  );
}
