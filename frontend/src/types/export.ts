export type ExportFormat = "srt" | "vtt" | "json" | "mp4";
export type ExportStatus = "pending" | "processing" | "completed" | "failed";

export interface VideoExport {
  id: number;
  video_id: number;
  format: ExportFormat;
  status: ExportStatus;
  /** Null until the file exists. */
  size_bytes: number | null;
  progress: number;
  error_message: string | null;
  created_at: string;
  /**
   * The frame height a burn was rendered at. Null for a sidecar, and for a
   * burn rendered at the source's own size — which is what every export made
   * before the resolution option existed is.
   */
  height: number | null;
}

export interface ExportList {
  items: VideoExport[];
  total: number;
}

/** Short-lived credential for the download URL — an <a> can't send headers. */
export interface DownloadTicket {
  token: string;
  expires_in: number;
}

/** One offer in the resolution picker, as the server computed it. */
export interface ExportResolution {
  height: number;
  /** Derived from the source's aspect ratio server-side, so it cannot disagree. */
  width: number;
  label: string;
  /** Above the source's own height: sharper captions, no more picture detail. */
  upscaled: boolean;
  /** The source's own size, and so the only choice that resamples nothing. */
  native: boolean;
}

/**
 * What this installation can render.
 *
 * The capability is the *server's*, not the browser's. Burning captions is an
 * FFmpeg re-encode that happens in the worker; the browser only downloads the
 * result, so the machine viewing this page has no bearing on what can be made.
 */
export interface ExportOptions {
  source_width: number | null;
  source_height: number | null;
  /**
   * What the picker should default to — not the source's own height.
   *
   * Caption sizes scale with the frame, so a 144p source renders a 48px
   * caption at 6px. Defaulting to the source would mean the obvious button
   * produces output whose captions cannot be read, which is the one thing this
   * tool must not do. The server picks the smallest step that clears a legible
   * caption size, and never one below the source.
   */
  recommended_height: number | null;
  /** The hardware encoder doing the work, or null when it is CPU x264. */
  hardware_encoder: string | null;
  resolutions: ExportResolution[];
}
