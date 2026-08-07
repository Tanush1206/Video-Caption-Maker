"use client";

import { useEffect } from "react";

import type { Playback } from "@/hooks/use-playback";

const SKIP_MS = 5000;

/**
 * Editing keystrokes must never reach the transport.
 *
 * Space is the obvious hazard — a caption editor where the space bar pauses
 * the video instead of typing a space is unusable — but arrow keys inside a
 * textarea move the caret, and every one of these keys means something else
 * while text is focused.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

/** Transport shortcuts, borrowed from the ones video editors already know. */
export function usePlayerShortcuts(playback: Playback) {
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      switch (event.key) {
        case " ":
          // Without this the page also scrolls, which it always does on space.
          event.preventDefault();
          playback.toggle();
          break;
        case "ArrowLeft":
          event.preventDefault();
          playback.seekMs(playback.currentMs() - SKIP_MS);
          break;
        case "ArrowRight":
          event.preventDefault();
          playback.seekMs(playback.currentMs() + SKIP_MS);
          break;
        case ",":
          playback.stepFrames(-1);
          break;
        case ".":
          playback.stepFrames(1);
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [playback]);
}
