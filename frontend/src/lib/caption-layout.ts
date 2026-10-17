/**
 * Where a caption's lines break, how big it is drawn, and where it sits.
 *
 * The browser's copy of backend/app/services/caption_layout.py, line for
 * line: the burn hands libass that module's lines, size and position, and
 * the editor draws this one's, so the preview is the MP4. Change one, change
 * both; scripts/ui-check `layout-parity` compares them on real captions.
 *
 * The model, as there:
 *  - A caption is a box `box_width` of the frame wide (or the default for the
 *    frame's shape). Text wraps at that width minus its padding, never at its
 *    distance to an edge.
 *  - At most `max_lines` lines; past that the font shrinks in 2% steps to
 *    70%, then one more line is allowed, then the text keeps every line it
 *    needs. Text is never cut.
 *  - `pos_x`/`pos_y` are the box's centre, as fractions of the frame.
 *  - Everything it paints is slid inside a safe area 3% in from every edge.
 *
 * Widths come from canvas `measureText`, which shapes with HarfBuzz like
 * libass, on the same vendored files (or a metric-compatible system face).
 * Everything is laid out in the video's own pixels, where the burn lays out,
 * and drawn scaled to the player.
 */

import type { Alignment, CaptionStyle } from "@/types/style";

export const SAFE_AREA = 0.03;
export const DEFAULT_WIDTH_LANDSCAPE = 0.8;
export const DEFAULT_WIDTH_PORTRAIT = 0.85;
/** The Max width slider's range, as the API bounds it. */
export const MIN_BOX_WIDTH = 0.2;
export const MAX_BOX_WIDTH = 0.94;
/** Top / Middle / Bottom, the box centre's height (caption_style.PLACEMENT_Y). */
export const PLACEMENT_Y = { top: 0.12, middle: 0.5, bottom: 0.88 } as const;

const SHRINK_STEPS = Array.from({ length: 16 }, (_, i) => (100 - 2 * i) / 100);
const MEASURE_EM = 100;
const OVERHANG_EM = 0.1;
const BLEED_PX = 2;
const REFERENCE_HEIGHT = 1080;

const VIRAMAS = new Set("्্੍્୍்్್്්ฺ္្");
const JOINERS = new Set(["‌", "‍"]);
const MARK = /\p{M}/u;

export interface Segment {
  text: string;
  /** Null: the caption font. */
  family: string | null;
}

export interface Line {
  segments: Segment[];
  width: number;
  pitch: number;
}

export interface Layout {
  lines: Line[];
  /** libass Fontsize (the font's whole cell) after any shrink. */
  size: number;
  shrink: number;
  /** The em the text is drawn at: CSS font-size. */
  em: number;
  pad: number;
  shadow: number;
  /** Letter-spacing in video pixels, rounded as the Style line rounds it. */
  spacing: number;
  bleed: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  /** The wrap box: where the lines may go, and where the width handles sit. */
  boxLeft: number;
  boxWidth: number;
}

export interface Frame {
  width: number;
  height: number;
}

export function defaultWidth(frame: Frame): number {
  return frame.height > frame.width ? DEFAULT_WIDTH_PORTRAIT : DEFAULT_WIDTH_LANDSCAPE;
}

export function boxWidthOf(style: CaptionStyle, frame: Frame): number {
  return style.box_width ?? defaultWidth(frame);
}

/** Everything painted: the rectangle, the drop shadow and the bleed. */
export function ink(layout: Layout): { x: number; y: number; width: number; height: number } {
  const b = layout.bleed;
  return {
    x: layout.x - b,
    y: layout.y - b,
    width: layout.width + layout.shadow + 2 * b,
    height: layout.height + layout.shadow + 2 * b,
  };
}

/** Whether a long word may be broken before `chars[index]` (code points). */
export function breakable(chars: string[], index: number): boolean {
  const char = chars[index];
  const before = chars[index - 1];
  if (MARK.test(char) || JOINERS.has(char)) return false;
  return !VIRAMAS.has(before) && !JOINERS.has(before);
}

function units(text: string): number {
  let n = 0;
  for (const c of text) if (!MARK.test(c) && !JOINERS.has(c)) n++;
  return n;
}

const patterns = new Map<string, RegExp>();
function runPattern(chars: string): RegExp {
  let pattern = patterns.get(chars);
  if (!pattern) {
    pattern = new RegExp(`[${chars}][${chars}‌‍]*`, "gu");
    patterns.set(chars, pattern);
  }
  return pattern;
}

let context: CanvasRenderingContext2D | null = null;
const widths = new Map<string, number>();

/** Advance width of `text` at MEASURE_EM in a CSS font family. */
function advance(family: string, weight: number, italic: boolean, text: string): number {
  if (!text) return 0;
  const font = `${italic ? "italic " : ""}${weight} ${MEASURE_EM}px ${family}`;
  const key = `${font}\u0000${text}`;
  let width = widths.get(key);
  if (width === undefined) {
    context ??= document.createElement("canvas").getContext("2d");
    if (!context) return 0;
    context.font = font;
    // The canvas default is the page's: kerning on, no extra spacing — what
    // HarfBuzz does for libass. Letter-spacing is added per character below.
    width = context.measureText(text).width;
    widths.set(key, width);
  }
  return width;
}

/** Forget measured widths: a face finished loading and earlier ones were a fallback's. */
export function clearMeasurements(): void {
  widths.clear();
}

/** The font strings a style draws with, for `document.fonts.load`. */
export function fontsFor(style: CaptionStyle): string[] {
  const out: string[] = [];
  for (const weight of [400, 700]) {
    const italic = style.italic ? "italic " : "";
    out.push(`${italic}${weight} ${MEASURE_EM}px ${style.font_css_stack}`);
    for (const face of style.script_fonts ?? []) out.push(`${italic}${weight} ${MEASURE_EM}px "${face.family}"`);
  }
  return out;
}

class Measurer {
  private readonly weight: number;
  constructor(
    private readonly style: CaptionStyle,
    bold: boolean
  ) {
    this.weight = bold ? 700 : 400;
  }

  segments(text: string): Segment[] {
    const chars = Array.from(text);
    // Code-unit offsets to code-point indexes, for the regex matches.
    const index: number[] = [];
    let unit = 0;
    chars.forEach((c, i) => {
      index[unit] = i;
      unit += c.length;
    });
    index[unit] = chars.length;
    const marks: (string | null)[] = chars.map(() => null);
    for (const face of this.style.script_fonts ?? []) {
      for (const match of text.matchAll(runPattern(face.chars))) {
        const start = index[match.index ?? 0];
        const end = index[(match.index ?? 0) + match[0].length];
        for (let i = start; i < end; i++) marks[i] = face.family;
      }
    }
    const out: Segment[] = [];
    let start = 0;
    for (let i = 1; i <= chars.length; i++) {
      if (i === chars.length || marks[i] !== marks[start]) {
        out.push({ text: chars.slice(start, i).join(""), family: marks[start] });
        start = i;
      }
    }
    return out;
  }

  width(text: string): number {
    let total = 0;
    for (const s of this.segments(text)) {
      const family = s.family === null ? this.style.font_css_stack : `"${s.family}"`;
      total += advance(family, this.weight, this.style.italic, s.text);
    }
    return total;
  }

  span(family: string | null): number {
    const primary = this.style.font_win_span || 1;
    if (family === null) return primary;
    return this.style.script_fonts?.find((f) => f.family === family)?.span ?? primary;
  }
}

function chunks(word: string, fits: (s: string) => boolean): string[] {
  const out: string[] = [];
  let chars = Array.from(word);
  while (chars.length) {
    let end = 1;
    for (let i = 2; i <= chars.length; i++) {
      if (i < chars.length && !breakable(chars, i)) continue;
      if (!fits(chars.slice(0, i).join(""))) break;
      end = i;
    }
    while (end < chars.length && !breakable(chars, end)) end++;
    out.push(chars.slice(0, end).join(""));
    chars = chars.slice(end);
  }
  return out;
}

function greedy(tokens: string[], fits: (s: string) => boolean): string[] {
  const lines: string[] = [];
  for (const token of tokens) {
    if (lines.length && fits(`${lines[lines.length - 1]} ${token}`)) lines[lines.length - 1] += ` ${token}`;
    else lines.push(token);
  }
  return lines;
}

/** caption_layout.wrap: greedy for the line count, then the narrowest width that keeps it. */
export function wrap(text: string, maxWidth: number, width: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/u).filter(Boolean);
    if (!words.length) continue;
    const fits = (s: string, limit = maxWidth) => width(s) <= limit;
    const tokens = words.flatMap((w) => (fits(w) ? [w] : chunks(w, fits)));
    let result = greedy(tokens, fits);
    if (result.length > 1) {
      let lo = Math.max(...tokens.map(width));
      let hi = maxWidth;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if (greedy(tokens, (s) => fits(s, mid)).length <= result.length) hi = mid;
        else lo = mid;
      }
      result = greedy(tokens, (s) => fits(s, hi));
    }
    lines.push(...result);
  }
  return lines;
}

function slide(start: number, extent: number, frame: number): number {
  const lo = SAFE_AREA * frame;
  const hi = (1 - SAFE_AREA) * frame;
  if (extent > hi - lo) return (frame - extent) / 2 - start;
  if (start < lo) return lo - start;
  if (start + extent > hi) return hi - (start + extent);
  return 0;
}

/** Python's round(): halves to even, which is what the burn's numbers use. */
function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

export interface LayoutOptions {
  overrideScale?: number | null;
  bold?: boolean | null;
  /** Where the centre is asked to be, when it isn't the style's (a drag in flight). */
  center?: { x: number; y: number };
  /** The box width, when it isn't the style's (a width handle in flight). */
  boxWidth?: number;
}

/** caption_layout.layout_caption, in the video's own pixels. */
export function layoutCaption(
  rawText: string,
  style: CaptionStyle,
  frame: Frame,
  options: LayoutOptions = {}
): Layout {
  const bold = options.bold ?? style.bold;
  const measure = new Measurer(style, bold);
  const k = frame.height / (style.reference_height || REFERENCE_HEIGHT);
  const boxed = style.box_opacity > 0;
  // As the ASS Style line rounds them (caption_style.box_pad).
  const pad = boxed ? Math.max(1, pyRound(style.box_padding * k)) : pyRound(style.outline_width * k);
  const shadow = boxed ? 0 : pyRound(style.shadow * k);
  const spacing = pyRound(style.letter_spacing * k);
  const size = style.font_size * (options.overrideScale || 1) * k;
  const text = style.uppercase ? rawText.toUpperCase() : rawText;
  const primarySpan = measure.span(null);

  const box = (options.boxWidth ?? boxWidthOf(style, frame)) * frame.width;
  const maxWidth = Math.max(1, box - 2 * pad);
  const widthAt = (shrink: number) => {
    const em = (size * shrink) / primarySpan;
    return (s: string) => (measure.width(s) * em) / MEASURE_EM + spacing * units(s);
  };

  let chosen: [number, string[]] | null = null;
  for (const allowed of [style.max_lines, style.max_lines + 1]) {
    for (const shrink of SHRINK_STEPS) {
      const lines = wrap(text, maxWidth, widthAt(shrink));
      if (lines.length <= allowed) {
        chosen = [shrink, lines];
        break;
      }
    }
    if (chosen) break;
  }
  const last = SHRINK_STEPS[SHRINK_STEPS.length - 1];
  const [shrink, texts] = chosen ?? [last, wrap(text, maxWidth, widthAt(last))];

  const em = (size * shrink) / primarySpan;
  const bleed = OVERHANG_EM * em + BLEED_PX;
  const width = widthAt(shrink);
  const lines: Line[] = texts.map((t) => {
    const segments = measure.segments(t);
    return { segments, width: width(t), pitch: em * Math.max(...segments.map((s) => measure.span(s.family))) };
  });
  const textWidth = Math.max(0, ...lines.map((l) => l.width));
  const rectW = textWidth + 2 * pad;
  const rectH = lines.reduce((sum, l) => sum + l.pitch, 0) + 2 * pad;

  const rectLeft = (center: number, alignment: Alignment) =>
    alignment === "left" ? center - box / 2 : alignment === "right" ? center + box / 2 - rectW : center - rectW / 2;

  let cx = (options.center?.x ?? style.pos_x) * frame.width;
  let cy = (options.center?.y ?? style.pos_y) * frame.height;
  cx += slide(rectLeft(cx, style.alignment) - bleed, rectW + shadow + 2 * bleed, frame.width);
  cy += slide(cy - rectH / 2 - bleed, rectH + shadow + 2 * bleed, frame.height);

  return {
    lines,
    size: size * shrink,
    shrink,
    em,
    pad,
    shadow,
    spacing,
    bleed,
    x: rectLeft(cx, style.alignment),
    y: cy - rectH / 2,
    width: rectW,
    height: rectH,
    centerX: cx,
    centerY: cy,
    boxLeft: cx - box / 2,
    boxWidth: box,
  };
}
