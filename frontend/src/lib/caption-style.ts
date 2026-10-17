/**
 * Turning a CaptionStyle into CSS.
 *
 * This is the browser-side twin of `to_ass_style` in
 * backend/app/services/caption_style.py. The two describe the same appearance
 * to two unrelated renderers, and the milestone is only done if they agree —
 * so anything either side computes independently is a place they can drift.
 * Where text breaks, how big it is and where it goes is not decided here at
 * all: that is the layout (lib/caption-layout.ts), the browser's copy of the
 * one the burn uses.
 */

import type { CSSProperties } from "react";

import type { Layout } from "@/lib/caption-layout";
import type { Caption } from "@/types/caption";
import type { CaptionStyle, Font } from "@/types/style";

/**
 * Indic scripts (and Cyrillic, for a caption font without it) are drawn in
 * vendored Noto faces, in the preview and in the burn alike. libass names them
 * per run (`subtitles._script_runs`); here they lead the stack and
 * `unicode-range` keeps them to their own characters. The server decides
 * which (`script_font_stack`); this is the Indic set, for a style cached
 * from before that field existed.
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

/**
 * The painted caption: font, colour, and the outline or box, at the size and
 * padding the layout settled on (lib/caption-layout.ts), drawn at `scale`
 * player pixels per video pixel.
 *
 * Its lines and position come from the layout as well; nothing here decides
 * where text breaks or where the box goes.
 */
export function captionPaintStyle(
  style: CaptionStyle,
  font: Font | undefined,
  layout: Layout,
  scale: number,
  override?: Override
): CSSProperties {
  const boxed = style.box_opacity > 0;

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
    position: "absolute",
    left: `${layout.x * scale}px`,
    top: `${layout.y * scale}px`,
    width: `${layout.width * scale}px`,
    height: `${layout.height * scale}px`,
    boxSizing: "border-box",
    padding: `${layout.pad * scale}px`,
    // The style's own resolved stack, with the script faces first: each is
    // limited to its own script by unicode-range (globals.css), so they take
    // only those characters, in the same files and at the same em the export
    // uses (SCRIPT_FONTS). `font` is a fallback for a cached style response
    // from before these fields existed.
    fontFamily: `${style.script_font_stack || SCRIPT_FONT_STACK}, ${style.font_css_stack || font?.css_stack || "sans-serif"}`,
    // The layout's em, which is libass's Fontsize divided by the font's win
    // span: libass sizes a face's whole cell, CSS its em. Without that the
    // preview drew Poppins Bold 1.76x the size of the export.
    fontSize: `${layout.em * scale}px`,
    fontWeight: (override?.override_bold ?? style.bold) ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    textDecorationLine: decoration || "none",
    // ASS `Spacing`, rounded to video pixels as the Style line rounds it.
    letterSpacing: `${layout.spacing * scale}px`,
    color: override?.override_color ?? style.text_color,
    textAlign: style.alignment,
  };

  if (boxed) {
    // A box replaces the outline entirely, in the burn too, so the
    // stroke is deliberately not applied here as well. Uniform padding,
    // because libass pads equally on all four sides.
    css.backgroundColor = hexToRgba(style.box_color, style.box_opacity);
  } else {
    // The outline is drawn outside the glyphs, into the padding the layout
    // reserved for it, so the element itself carries no padding.
    css.padding = 0;
    css.left = `${(layout.x + layout.pad) * scale}px`;
    css.top = `${(layout.y + layout.pad) * scale}px`;
    css.width = `${(layout.width - 2 * layout.pad) * scale}px`;
    css.height = `${(layout.height - 2 * layout.pad) * scale}px`;
    if (style.outline_width > 0) {
      // ASS draws its outline *outside* the glyph. `-webkit-text-stroke` centres
      // the stroke on the path, so half of it would be eaten by the fill and the
      // letters would look thinner than the export. Doubling the width and
      // painting the stroke first reproduces an outward outline.
      css.WebkitTextStrokeWidth = `${layout.pad * 2 * scale}px`;
      css.WebkitTextStrokeColor = style.outline_color;
      css.paintOrder = "stroke fill";
    }

    if (layout.shadow > 0) {
      // ASS offsets the shadow down and right by `Shadow` pixels with no blur,
      // so the third length is 0 rather than a softening radius — a blurred
      // shadow would look better here and be a lie about the export.
      const offset = layout.shadow * scale;
      css.textShadow = `${offset}px ${offset}px 0 ${style.shadow_color}`;
    }
  }

  return css;
}

/** One laid-out line: exactly its own height, which is libass's line pitch. */
export function captionLineStyle(pitch: number, scale: number): CSSProperties {
  return {
    display: "block",
    height: `${pitch * scale}px`,
    lineHeight: `${pitch * scale}px`,
    // The lines are the layout's; the browser must not break them again.
    whiteSpace: "pre",
  };
}
