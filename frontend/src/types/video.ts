export type VideoStatus = "pending" | "processing" | "completed" | "failed";

export interface Video {
  id: number;
  title: string;
  original_filename: string;
  size_bytes: number;
  content_type: string;
  duration_ms: number | null;
  status: VideoStatus;
  error_message: string | null;
  has_thumbnail: boolean;
  /**
   * What was asked for last time this video was transcribed.
   *
   * `spoken_language` is "auto" or an ISO code — a hint to Whisper about what
   * it is listening to. `caption_language` is "same" or an ISO code — what the
   * captions should come out in. They are different questions: French captions
   * on English audio is a translation, not a detection.
   */
  spoken_language: string;
  caption_language: string;
  /**
   * How Hindi is written: "roman" (Hinglish), "devanagari" or "auto" (decided
   * from detection); null on videos from before v1.0.9 (Devanagari).
   */
  hindi_script: string | null;
  /** What was heard from the first 30 s, once detection has answered. */
  detected_language: string | null;
  detected_confidence: number | null;
  /** Uploaded while the language step is open; not started yet. */
  held: boolean;
  /** 0-100, meaningful only while status is "processing". */
  progress: number;
  /**
   * "downloading" | "extracting" | "transcribing" | "translating" |
   * "embedding", or null when idle.
   */
  stage: string | null;
  /** A sentence about the current stage, e.g. "Downloading … 1.2 of 2.9 GB". */
  stage_detail: string | null;
  /** A non-fatal note on a finished job, e.g. a translation fallback. */
  notice: string | null;
  created_at: string;
  updated_at: string;
}

export interface VideoList {
  items: Video[];
  total: number;
}

/** Accepted by the upload input; mirrors the backend's allowlist. */
export const ACCEPTED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
  "video/x-msvideo",
  "video/x-m4v",
];

export const ACCEPTED_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"];

export interface LanguageOption {
  code: string;
  /** The English name, or "Auto-detect" / "Same as spoken". */
  label: string;
  /** The name in the language itself ("বাংলা"); null for auto and same. */
  native: string | null;
}

export interface HindiScriptOption {
  /** "roman" or "devanagari". */
  code: string;
  /** "Hinglish (Roman)" / "हिन्दी (Devanagari)". */
  label: string;
  /** "Hinglish" / "हिन्दी". */
  short: string;
  /** What choosing it downloads the first time; null if nothing. */
  download_bytes: number | null;
}

export interface LanguageOptions {
  spoken: LanguageOption[];
  caption: LanguageOption[];
  hindi_scripts: HindiScriptOption[];
  /** Hindi detected at or above this presets Hinglish. */
  hinglish_min_confidence: number;
  /**
   * Always true: English comes from Whisper itself and the others from the
   * local M2M100 translator, so no key is needed for any of them.
   */
  translation_available: boolean;
}
