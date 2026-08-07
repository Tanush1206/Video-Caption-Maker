export type VerticalPosition = "top" | "middle" | "bottom";
export type Alignment = "left" | "center" | "right";

export interface CaptionStyle {
  video_id: number;
  font_key: string;
  /** Pixels on a `reference_height`-tall frame, scaled to whatever we render at. */
  font_size: number;
  bold: boolean;
  italic: boolean;
  text_color: string;
  outline_color: string;
  outline_width: number;
  box_color: string;
  /** 0 disables the box; the server also flips ASS BorderStyle on this. */
  box_opacity: number;
  position: VerticalPosition;
  alignment: Alignment;
  margin_v: number;
  margin_h: number;
  /**
   * Derived server-side, not stored. Sent so the preview uses the same padding
   * as the renderer instead of reimplementing the rule and drifting from it.
   */
  box_padding: number;
  reference_height: number;
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
