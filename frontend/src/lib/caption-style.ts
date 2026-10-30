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
/**
 * An outline of `radius` pixels as text shadows: the glyph offset round
 * circles of that radius and smaller, so the corners come out round.
 */
export function outlineRing(radius: number, colour: string): string {
  const shadows: string[] = [];
  for (const r of [radius, radius * 0.66, radius * 0.33]) {
    const steps = Math.max(8, Math.ceil(2 * Math.PI * r));
    for (let i = 0; i < steps; i++) {
      const a = (2 * Math.PI * i) / steps;
      shadows.push(`${(r * Math.cos(a)).toFixed(2)}px ${(r * Math.sin(a)).toFixed(2)}px 0 ${colour}`);
    }
  }
  return shadows.join(", ");
}

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
    // The outline and the shadow are separate layers (`captionOutlineStyle`,
    // `captionShadowFilter`), drawn under and round this one, as libass
    // draws them.
  }

  return css;
}

/**
 * The outline, as its own layer under the caption: the same text, transparent,
 * with `outlineRing` as its shadows. ASS draws an outline outside the glyphs
 * with round corners, under every fill, an underline's and strikeout's too.
 * Until v1.3.0 a doubled `-webkit-text-stroke`: mitred, and Chrome ignores
 * `stroke-linejoin` on text, so the 6-pixel default grew spikes off "v" and
 * Anton's corners the burn never drew. On the caption itself, the ring of a
 * line-through is painted over the letters; underneath, it can't be.
 * Null when there is no outline (or a box replaces it).
 */
export function captionOutlineStyle(
  style: CaptionStyle,
  font: Font | undefined,
  layout: Layout,
  scale: number,
  override?: Override
): CSSProperties | null {
  if (style.box_opacity > 0 || style.outline_width <= 0) return null;
  return {
    ...captionPaintStyle(style, font, layout, scale, override),
    color: "transparent",
    textShadow: outlineRing(layout.pad * scale, style.outline_color),
  };
}

/**
 * The shadow of the outlined caption as one shape, for a layer holding both:
 * ASS offsets the outlined text down and right by `Shadow` pixels, unblurred.
 * `text-shadow` on the text shadowed its fill above the outline (v1.3.0).
 */
export function captionShadowFilter(style: CaptionStyle, layout: Layout, scale: number): string | undefined {
  if (style.box_opacity > 0 || layout.shadow <= 0) return undefined;
  // No blur: a blurred shadow would look better here and be a lie about the export.
  const offset = layout.shadow * scale;
  return `drop-shadow(${offset}px ${offset}px 0 ${style.shadow_color})`;
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
