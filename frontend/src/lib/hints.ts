"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A hint shown once (v1.1.0): the first time something is hovered, then
 * never again. Remembered in localStorage per hint; where storage is
 * unavailable (a private window, blocked site data) it is shown once per page
 * load instead.
 *
 * `show` on pointer enter, `done` on pointer leave: the hint stays while the
 * pointer is there, and leaving marks it seen.
 */
export function useOnceHint(name: string): { showing: boolean; show: () => void; done: () => void } {
  const key = `vcm-hint-${name}`;
  // Seen until storage says otherwise, so nothing flashes before mount.
  const [seen, setSeen] = useState(true);
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    try {
      setSeen(localStorage.getItem(key) === "seen");
    } catch {
      setSeen(false);
    }
  }, [key]);

  const show = useCallback(() => {
    if (!seen) setShowing(true);
  }, [seen]);

  const done = useCallback(() => {
    if (!showing) return;
    setShowing(false);
    setSeen(true);
    try {
      localStorage.setItem(key, "seen");
    } catch {
      // Storage unavailable: seen for this page load only.
    }
  }, [showing, key]);

  return { showing, show, done };
}

/** The small dark tooltip a hint is drawn in. */
export const HINT_CLASS =
  "pointer-events-none absolute z-30 w-max max-w-64 animate-fade-in rounded-lg bg-foreground/90 px-2.5 py-1.5 text-xs text-background shadow-overlay";
