/**
 * The arithmetic behind a windowed list.
 *
 * Pure and separate from the component that uses it, because an off-by-one
 * here is invisible until someone scrolls to exactly the wrong place, and
 * because this is the part worth testing without a browser.
 *
 * The model: `tops[i]` is the offset of item i from the top of the list, and
 * `tops[count]` is the total height. Items may differ in height — a section
 * header is shorter than a row — so positions are precomputed rather than
 * derived by multiplication.
 */

/** Rows rendered beyond the viewport, so a fast scroll does not show gaps. */
export const OVERSCAN = 6;

/**
 * The largest index whose top is at or above `y`.
 *
 * Binary search rather than a walk: the list runs to thousands of entries and
 * this is called on every scroll event.
 */
export function indexAt(tops: number[], y: number): number {
  let lo = 0;
  let hi = tops.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/**
 * Which slice of the list to render for a given scroll position.
 *
 * `scrollTop` is clamped to what the list can actually reach. A caller can
 * hold a scroll position that outlived the content — a scroll container
 * unmounts when a dropdown closes and comes back at zero, while the state
 * tracking it does not, and a list that shrinks after a search invalidates it
 * too. Unclamped, either case positions every rendered row below the visible
 * window and the list looks empty while its scrollbar looks fine.
 */
export function visibleRange(
  tops: number[],
  scrollTop: number,
  viewport: number,
  count: number
): { start: number; end: number } {
  if (count === 0) return { start: 0, end: 0 };

  const total = tops[count];
  const y = Math.max(0, Math.min(scrollTop, Math.max(0, total - viewport)));

  const first = indexAt(tops, y);
  let last = first;
  while (last < count - 1 && tops[last + 1] < y + viewport) last++;

  return {
    start: Math.max(0, first - OVERSCAN),
    end: Math.min(count, last + 1 + OVERSCAN),
  };
}
