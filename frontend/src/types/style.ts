export type VerticalPosition = "top" | "middle" | "bottom";
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
  position: VerticalPosition;
  alignment: Alignment;
  margin_v: number;
  /**
   * Also the line-wrapping width in both renderers: ASS derives it from
   * MarginL/MarginR whether or not the caption is placed by hand, so this
   * still means something under free placement while `margin_v` does not.
   */
  margin_h: number;
  /**
   * Free placement, as a fraction of the frame — set by dragging the caption.
   *
   * Null means the caption is anchored by `position`/`alignment` and the
   * margins, which is the default and what the placement grid sets. The two
   * modes are exclusive, and the overlay switches on this being null, so it
   * must survive as null rather than being defaulted to a number.
   */
  pos_x: number | null;
  pos_y: number | null;
  reference_height: number;
  /**
   * Resolved server-side from `font_key`. With 1301 catalogue families the
   * client can no longer look this up in a list it already holds, and the
   * pairing between what libass renders and what the browser is asked for
   * stays a single server-side decision.
   */
  font_family: string;
  font_css_stack: string;
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
