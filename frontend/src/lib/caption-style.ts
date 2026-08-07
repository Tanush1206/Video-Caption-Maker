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

import type { Caption } from "@/types/caption";
import type { CaptionStyle, Font } from "@/types/style";

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

  const css: CSSProperties = {
    fontFamily: font?.css_stack ?? "sans-serif",
    fontSize: `${style.font_size * emphasisScale * scale}px`,
    fontWeight: (override?.override_bold ?? style.bold) ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    color: override?.override_color ?? style.text_color,
    lineHeight: 1.2,
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
  } else if (style.outline_width > 0) {
    // ASS draws its outline *outside* the glyph. `-webkit-text-stroke` centres
    // the stroke on the path, so half of it would be eaten by the fill and the
    // letters would look thinner than the export. Doubling the width and
    // painting the stroke first reproduces an outward outline.
    css.WebkitTextStrokeWidth = `${style.outline_width * 2 * scale}px`;
    css.WebkitTextStrokeColor = style.outline_color;
    css.paintOrder = "stroke fill";
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

/** Where the caption sits in the frame — the CSS side of ASS `Alignment`. */
export function captionBoxStyle(style: CaptionStyle, scale: number): CSSProperties {
  return {
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
