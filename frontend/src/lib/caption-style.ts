/**
 * Turning a CaptionStyle into CSS.
 *
 * This is the browser-side twin of `to_ass_style` in
 * backend/app/services/caption_style.py. The two describe the same appearance
 * to two unrelated renderers, and the milestone is only done if they agree —
 * so anything either side computes independently is a place they can drift.
 * Where a rule could live in one place it does: `box_padding` is derived on
 * the server and sent, rather than recomputed here.
 */

import type { CSSProperties } from "react";

import { ANCHOR_SHIFT } from "@/lib/caption-drag";
import type { Caption } from "@/types/caption";
import type { CaptionStyle, Font } from "@/types/style";

/**
 * Indic scripts are drawn in vendored Noto faces, in the preview and in the
 * burn alike. libass names them per run (`subtitles._script_runs`); here they
 * lead the stack and `unicode-range` keeps them to their own characters.
 */
const SCRIPT_FONT_STACK =
  '"Noto Sans Devanagari", "Noto Sans Bengali", "Noto Sans Tamil", "Noto Sans Malayalam"';

/** Per-caption emphasis, or nothing when the caption inherits. */
type Override = Pick<Caption, "override_color" | "override_bold" | "override_scale">;

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * How much to multiply reference-pixel sizes by.
 *
 * Note this is the *rendered* height, not the video's own. The preview is
 * usually smaller than the file, and a caption has to occupy the same
 * proportion of the box either way.
 */
export function scaleFor(renderedHeight: number, referenceHeight: number): number {
  return renderedHeight / referenceHeight;
}

/** Text styling — font, colour, and the outline or box. */
export function captionTextStyle(
  style: CaptionStyle,
  font: Font | undefined,
  scale: number,
  override?: Override
): CSSProperties {
  const boxed = style.box_opacity > 0;
  const emphasisScale = override?.override_scale ?? 1;
  // libass sizes a face so its whole cell (usWinAscent + usWinDescent) is the
  // font size; CSS sizes the em. Without this the preview drew Poppins Bold
  // 1.76x the size of the export — different wrapping, and every caption
  // smaller on the video than in the editor. `?? 1` for a cached style from
  // before the field existed.
  const span = style.font_win_span || 1;

  // ASS Underline / StrikeOut, which are real fields in the Style line. The
  // decoration inherits `currentColor`, and so does libass — both draw the rule
  // in the primary colour, so neither needs telling.
  const decoration = [
    style.underline ? "underline" : null,
    style.strikeout ? "line-through" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const css: CSSProperties = {
    // The style's own resolved stack first: it covers every catalogue font,
    // where `font` is only ever one of the nine built-ins. The lookup is kept
    // as a fallback for a cached style response from before this field existed.
    // The Indic script faces first: each is limited to its own script by
    // unicode-range (globals.css), so they take only those characters, in
    // the same files and at the same em the export uses (SCRIPT_FONTS).
    fontFamily: `${SCRIPT_FONT_STACK}, ${style.font_css_stack || font?.css_stack || "sans-serif"}`,
    fontSize: `${(style.font_size * emphasisScale * scale) / span}px`,
    fontWeight: (override?.override_bold ?? style.bold) ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    textDecorationLine: decoration || "none",
    // ASS has no property for letter case, so the burn-in upper-cases the
    // dialogue text itself. Different mechanism, same pixels.
    textTransform: style.uppercase ? "uppercase" : "none",
    // ASS `Spacing`, in the same reference pixels as everything else here.
    letterSpacing: `${style.letter_spacing * scale}px`,
    color: override?.override_color ?? style.text_color,
    // libass's line pitch is that same cell, so a wrapped caption's lines are
    // as far apart here as in the export, and a box is as tall.
    lineHeight: span,
    whiteSpace: "pre-wrap",
    display: "inline-block",
  };

  if (boxed) {
    // ASS BorderStyle 3: an opaque box replaces the outline entirely, so the
    // stroke is deliberately not applied here as well.
    css.backgroundColor = hexToRgba(style.box_color, style.box_opacity);
    // Uniform, because libass applies its box padding equally on all four
    // sides. Wider horizontal padding looks better in the browser, and that is
    // exactly why it would be wrong — the export would not have it.
    css.padding = `${style.box_padding * scale}px`;
  } else {
    if (style.outline_width > 0) {
      // ASS draws its outline *outside* the glyph. `-webkit-text-stroke` centres
      // the stroke on the path, so half of it would be eaten by the fill and the
      // letters would look thinner than the export. Doubling the width and
      // painting the stroke first reproduces an outward outline.
      css.WebkitTextStrokeWidth = `${style.outline_width * 2 * scale}px`;
      css.WebkitTextStrokeColor = style.outline_color;
      css.paintOrder = "stroke fill";
    }

    if (style.shadow > 0) {
      // ASS offsets the shadow down and right by `Shadow` pixels with no blur,
      // so the third length is 0 rather than a softening radius — a blurred
      // shadow would look better here and be a lie about the export.
      //
      // Only when unboxed, matching `to_ass_style`: BackColour is the box fill
      // at BorderStyle 3 and cannot also be the shadow colour.
      const offset = style.shadow * scale;
      css.textShadow = `${offset}px ${offset}px 0 ${style.shadow_color}`;
    }
  }

  return css;
}

const VERTICAL: Record<CaptionStyle["position"], CSSProperties["alignItems"]> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

const HORIZONTAL: Record<CaptionStyle["alignment"], CSSProperties["justifyContent"]> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

/** The hand-placed position, or null when the caption is anchored. */
export function freePosition(style: CaptionStyle): { x: number; y: number } | null {
  // `!= null` rather than `!== null`: a style response cached from before these
  // fields existed has them undefined, not null, and that has to read as
  // "anchored" instead of throwing a NaN into a transform.
  if (style.pos_x == null || style.pos_y == null) return null;
  return { x: style.pos_x, y: style.pos_y };
}

/**
 * The CSS twin of `translate(-50%)` on the anchor — see ANCHOR_SHIFT.
 *
 * Expressed as a percentage of the caption's own width, which is what makes it
 * agree with ASS: `\an4/5/6` anchor the text box at its left edge, its centre
 * or its right edge, and a percentage translate is measured against the same
 * box. Neither side needs to know how wide the text turned out to be.
 */
function anchorTransform(style: CaptionStyle): string {
  return `translate(${-ANCHOR_SHIFT[style.alignment] * 100}%, -50%)`;
}

/**
 * Where the caption sits in the frame.
 *
 * Two modes, because the format has two. An *anchored* caption is the CSS side
 * of ASS `Alignment` plus margins — nine positions and a gap from the edge.
 * A *hand-placed* one is the CSS side of `\an` plus `\pos`, which is a
 * per-event override rather than a Style field and can go anywhere.
 *
 * Both return an absolutely positioned box, so the caller can keep one element
 * for the caption and a separate, unpadded one for the frame it is measured
 * against. That separation is not cosmetic: while the margins lived as padding
 * on the *measured* element, the height feeding `scaleFor` was the frame minus
 * the margins, and the scale it produced was then used to compute those very
 * margins — a loop that settled at s = F / (R + 2m) and visibly shrank the
 * caption the further it was pushed from an edge.
 */
export function captionBoxStyle(style: CaptionStyle, scale: number): CSSProperties {
  const free = freePosition(style);

  if (free) {
    return {
      position: "absolute",
      left: `${free.x * 100}%`,
      top: `${free.y * 100}%`,
      // Its own width, not whatever is left of the frame after `left`. An
      // absolute box shrinks to fit the space between its left edge and the
      // frame's right edge, so the same caption wrapped into a narrow column
      // near the right of the frame and spread out near the left — its size
      // changed under the drag that was clamping it by that size, and it
      // could be pushed half out of frame. libass doesn't do that: under
      // `\pos` it wraps at the margins and nowhere else, which is maxWidth.
      width: "max-content",
      // A flex item, not an inline-block on a text line. On a line it sits
      // on the baseline with descender room below it, so the box was taller
      // than the text and the text's centre sat a few pixels above the
      // point `\an5\pos` names — a jump on grab, and a save that was off by
      // the same few pixels. Anchored mode is already a flex container.
      display: "flex",
      justifyContent: HORIZONTAL[style.alignment],
      transform: anchorTransform(style),
      // The wrap width, and the one thing `\pos` does *not* take over: libass
      // still breaks lines at PlayResX minus the horizontal margins. Verified
      // by burning the same line with and without `\pos` at a 700px margin —
      // six lines, 498px wide, both ways. `100%` resolves against the frame,
      // because that is this element's containing block.
      maxWidth: `calc(100% - ${2 * style.margin_h * scale}px)`,
      textAlign: style.alignment,
    };
  }

  return {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: VERTICAL[style.position],
    justifyContent: HORIZONTAL[style.alignment],
    textAlign: style.alignment,
    // ASS margins are the gap between the text and the frame edge, which is
    // exactly what padding on a full-bleed flex container gives.
    paddingLeft: `${style.margin_h * scale}px`,
    paddingRight: `${style.margin_h * scale}px`,
    paddingTop: `${style.margin_v * scale}px`,
    paddingBottom: `${style.margin_v * scale}px`,
  };
}

/**
 * Move an already-rendered caption, without going through React.
 *
 * Used only while a drag is in flight. Every pointer event otherwise writes the
 * style into the query cache, which re-renders the whole editor — the player,
 * the style panel, the caption list — at pointer-event rate rather than at
 * frame rate, and that is what made dragging feel like it was catching.
 *
 * Writes the whole free-mode box, exactly what `captionBoxStyle` would return
 * for this placement, so the hand-off when React catches up is a no-op rather
 * than a jump. The whole box and not just left/top: the first frames of a
 * drag (or the first arrow key) arrive while the style in the cache is still
 * anchored, and an anchored box is a full-bleed flex container — `top` on it
 * shrinks the container while the caption stays pinned to its bottom edge, so
 * the caption did not move vertically until the next render.
 */
export function applyFreePosition(
  node: HTMLElement,
  placement: { pos_x: number; pos_y: number },
  style: CaptionStyle,
  scale: number
): void {
  const css = captionBoxStyle({ ...style, ...placement }, scale);
  node.removeAttribute("style");
  Object.assign(node.style, css);
}
