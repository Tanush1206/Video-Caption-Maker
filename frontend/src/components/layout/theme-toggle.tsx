"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { useTheme } from "@/components/layout/theme-provider";
import { Button } from "@/components/ui/button";

/**
 * Sits inline wherever it is placed — the header, an auth page corner — rather
 * than being fixed to the viewport.
 *
 * It used to be `fixed right-4 top-4`, which meant every layout had to leave a
 * hole for it: the dashboard header carried an `mr-12` whose only job was to
 * dodge an element it did not contain, and a mobile menu would have opened
 * underneath it. Owning its position locally removes that coupling.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  // The server cannot know the stored theme, so rendering the real icon before
  // hydration risks a mismatch. Reserve the space and render a stable icon.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && theme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      className={className}
    >
      {/* Both icons are always rendered and cross-faded. Swapping the element
          would pop; rotating and scaling between them reads as one control
          changing state. */}
      <Sun
        className={
          isDark
            ? "absolute rotate-90 scale-0 transition-transform duration-300 ease-out"
            : "absolute rotate-0 scale-100 transition-transform duration-300 ease-out"
        }
        aria-hidden="true"
      />
      <Moon
        className={
          isDark
            ? "rotate-0 scale-100 transition-transform duration-300 ease-out"
            : "-rotate-90 scale-0 transition-transform duration-300 ease-out"
        }
        aria-hidden="true"
      />
    </Button>
  );
}
