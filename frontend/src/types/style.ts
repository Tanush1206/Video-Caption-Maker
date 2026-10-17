export type Alignment = "left" | "center" | "right";

export interface CaptionStyle {
  video_id: number;
  font_key: string;
  /** Pixels on a `reference_height`-tall frame, scaled to whatever we render at. */
  font_size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeout: boolean;
  /**
   * The one field ASS cannot express. The burn-in upper-cases the dialogue
   * text; the preview uses `text-transform`. Neither touches the stored
   * caption or the SRT/VTT sidecars.
   */
  uppercase: boolean;
  /** ASS `Spacing`, in reference pixels. Negative tightens. */
  letter_spacing: number;
  text_color: string;
  outline_color: string;
  outline_width: number;
  /** ASS `Shadow`: offset down-right in reference pixels, never blurred. */
  shadow: number;
  shadow_color: string;
  box_color: string;
  /** 0 disables the box; the server also flips ASS BorderStyle on this. */
  box_opacity: number;
  /** Only drawn when `box_opacity` is above 0, matching ASS BorderStyle 3. */
  box_padding: number;
  /** How the lines justify against each other and sit in the box. */
  alignment: Alignment;
  /**
   * The caption box's centre, as fractions of the frame. Where the box is
   * asked to be: each caption is slid inside the safe area on its own
   * (lib/caption-layout.ts), because each one is a different size.
   */
  pos_x: number;
  pos_y: number;
  /** The box's width as a fraction of the frame's; null is the default for its shape. */
  box_width: number | null;
  /** Lines before the font shrinks to fit (down to 70%). */
  max_lines: number;
  reference_height: number;
  /**
   * Resolved server-side from `font_key`. With 1301 catalogue families the
   * client can no longer look this up in a list it already holds, and the
   * pairing between what libass renders and what the browser is asked for
   * stays a single server-side decision.
   */
  font_family: string;
  font_css_stack: string;
  /**
   * The face's (usWinAscent + usWinDescent) / unitsPerEm. libass makes that
   * span the font size; CSS makes the em the font size. Divide by it.
   */
  font_win_span: number;
  /**
   * The script faces to list before the caption font (each limited to its
   * script by unicode-range), the same ones the burn uses.
   */
  script_font_stack: string;
  /** The same faces as data, for the layout: their characters and win spans. */
  script_fonts: ScriptFont[];
}

export interface ScriptFont {
  family: string;
  /** A regex character class body, exactly as the burn matches it. */
  chars: string;
  span: number;
}

export interface Font {
  key: string;
  label: string;
  /**
   * Chosen to be metric-compatible with the face libass renders with, so text
   * wraps in the same place in the preview as in the export.
   */
  css_stack: string;
}

export interface StyleOptions {
  fonts: Font[];
  presets: string[];
}

/** One family from the on-demand Google Fonts catalogue. */
export interface FontLibraryEntry {
  key: string;
  family: string;
  category: string;
  has_bold: boolean;
  css_stack: string;
}

/** What the catalogue generator kept and skipped, for the picker's info panel. */
export interface CatalogueMeta {
  /** Families in Google's own catalogue — what this app is measured against. */
  google_families: number;
  /** Shipped with a static face Google's designers drew. */
  static: number;
  /** Variable-only families, pinned to a static cut at download time. */
  instanced: number;
  skipped_oversized: number;
  skipped_unusable: number;
}

export interface FontSearchResult {
  /** How many families the catalogue holds — only ever right for an empty query. */
  total: number;
  /** How many the query found. This is the number to show beside a result list. */
  matched: number;
  /** How many of those came back, capped by the server. */
  returned: number;
  fonts: FontLibraryEntry[];
  meta: CatalogueMeta;
}
