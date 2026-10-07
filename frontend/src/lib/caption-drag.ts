/**
 * Turning a pointer position into a caption placement.
 *
 * Kept out of the component because it is pure, it is where the off-by-ones
 * live, and it can be reasoned about without a browser.
 *
 * ## Why this stopped snapping to nine anchors
 *
 * It used to. An ASS *Style* line places text with an alignment anchor plus
 * margins — nine positions and a gap from the edges — and there is no free x/y
 * in it, so dragging could only ever mean "pick the anchor you dropped nearest
 * and set the margin to the distance from that edge". Half the frame therefore
 * did nothing, and the centre band snapped hard.
 *
 * The escape is `\pos()`, a per-event override rather than a Style field. It
 * was avoided on the grounds that it would let the preview describe something
 * the Style block could not say — a fair worry, and wrong once measured. A
 * burn with `{\an5\pos(480,324)}` puts the caption within half a pixel of the
 * fraction it was given, and MarginL/MarginR keep governing where lines wrap
 * even under `\pos`. So free placement costs nothing that was being protected:
 * the wrap width is still decided in exactly one place, and the preview can
 * still promise everything the export will do.
 *
 * Anchored placement did not go away — it is still what the placement grid
 * sets, still what every existing style uses, and still the only mode that can
 * say "60px from the bottom, whatever the frame". Dragging switches a style to
 * free placement; the grid switches it back.
 */

import type { Alignment } from "@/types/style";

/** A hand-placed caption, as a fraction of the frame on each axis. */
export interface FreePlacement {
  pos_x: number;
  pos_y: number;
}

/** The caption's own rendered size, as a fraction of the frame. */
export interface BoxFraction {
  width: number;
  height: number;
}

/**
 * How far along its own width the anchor sits, per alignment.
 *
 * This is the CSS twin of ASS `\an4`/`\an5`/`\an6`, and the reason those three
 * are the ones used: `\an` says which point of the text box `\pos` refers to
 * *and* how wrapped lines justify against each other, so the horizontal half
 * has to follow the caption's alignment or the two renderers would disagree
 * about a wrapped line. The vertical half is pinned to the middle row, which
 * is what makes `pos_y` mean "the vertical centre of the text" on both sides.
 */
export const ANCHOR_SHIFT: Record<Alignment, number> = {
  left: 0,
  center: 0.5,
  right: 1,
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Clamp one axis so the caption's *box* stays in frame, not just its anchor.
 *
 * `size` is the box's extent on this axis and `shift` where the anchor sits
 * along it, both as fractions. Clamping the anchor alone would let half a
 * caption hang off the edge — invisible in the preview and in the burn, which
 * is the failure the margin bounds already exist to prevent.
 *
 * When the caption is wider than the frame there is no legal position at all
 * and the two bounds cross. Their midpoint is the least-wrong answer — for a
 * centred caption it is exactly 0.5, which is what overflowing text should do
 * — and the final clamp keeps the result inside 0..1 either way, because the
 * API rejects anything outside that and a 422 mid-drag would be a dead editor.
 */
function clampAxis(value: number, size: number, shift: number): number {
  const min = shift * size;
  const max = 1 - (1 - shift) * size;
  if (min > max) return clamp01((min + max) / 2);
  return clamp01(Math.max(min, Math.min(max, value)));
}

/** Where a caption dragged to (x, y) may actually sit. */
export function clampPlacement(
  x: number,
  y: number,
  size: BoxFraction,
  alignment: Alignment
): FreePlacement {
  return {
    pos_x: clampAxis(x, size.width, ANCHOR_SHIFT[alignment]),
    pos_y: clampAxis(y, size.height, 0.5),
  };
}

/**
 * The anchor an *anchored* style is currently drawing at, from its own fields.
 *
 * Only used when the caption is not on screen to measure — in the gaps between
 * captions, which is most of a video. It ignores the caption's own height,
 * because there is no caption to have one; the drag that follows immediately
 * overwrites it, and nothing is visible to jump.
 *
 * When there *is* a caption, the overlay reads the rendered box instead. That
 * is exact, and being exact is what makes picking one up not move it.
 */
export function anchorFromStyle(
  position: "top" | "middle" | "bottom",
  alignment: Alignment,
  marginV: number,
  marginH: number,
  aspect: number,
  referenceHeight: number
): FreePlacement {
  const referenceWidth = referenceHeight * aspect;
  const v = marginV / referenceHeight;
  const h = marginH / referenceWidth;

  return {
    pos_x: clamp01(alignment === "left" ? h : alignment === "right" ? 1 - h : 0.5),
    pos_y: clamp01(position === "top" ? v : position === "bottom" ? 1 - v : 0.5),
  };
}
