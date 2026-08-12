"use client";

import { useEffect } from "react";

/**
 * Marks whichever element is currently being scrolled, so the scrollbar can be
 * invisible until it is wanted.
 *
 * CSS has no "is scrolling" state. `:hover` is the nearest thing and it answers
 * a different question — the pointer sits over a panel for as long as you read
 * it. So this sets `data-scrolling` on the scrolling element and clears it once
 * the scrolling stops; globals.css paints the thumb only while it is there.
 *
 * Renders nothing. Mounted once, in the root layout.
 */

/** How long the bar lingers after the last scroll event. */
const LINGER_MS = 700;

export function ScrollActivity() {
  useEffect(() => {
    // Per-element, not global: scrolling the caption list should not light up
    // the scrollbar on the rail beside it.
    const active = new Map<Element, { last: number; timer: number }>();

    const stop = (element: Element) => {
      const state = active.get(element);
      if (!state) return;

      // Rescheduled rather than cleared-and-reset on every event. A fast
      // wheel spin fires scroll dozens of times a second and tearing down a
      // timer each time is work for nothing; this way there is one timer per
      // burst, which fires, sees the burst is still going, and waits again.
      const idle = performance.now() - state.last;
      if (idle < LINGER_MS) {
        state.timer = window.setTimeout(() => stop(element), LINGER_MS - idle);
        return;
      }

      active.delete(element);
      element.removeAttribute("data-scrolling");
    };

    const onScroll = (event: Event) => {
      // A scroll of the page itself targets `document`, which has no
      // attributes — the element that actually scrolls, and that the scrollbar
      // belongs to, is the root.
      const target = event.target;
      const element =
        target instanceof Element ? target : document.scrollingElement ?? document.documentElement;

      const state = active.get(element);
      if (state) {
        state.last = performance.now();
        return;
      }

      element.setAttribute("data-scrolling", "");
      active.set(element, {
        last: performance.now(),
        timer: window.setTimeout(() => stop(element), LINGER_MS),
      });
    };

    // Capture, because scroll does not bubble: a listener on document only
    // hears about nested scroll containers on the way down.
    // Passive, because this never calls preventDefault and Chrome would
    // otherwise have to wait for it before scrolling.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });

    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      for (const [element, state] of active) {
        clearTimeout(state.timer);
        element.removeAttribute("data-scrolling");
      }
    };
  }, []);

  return null;
}
