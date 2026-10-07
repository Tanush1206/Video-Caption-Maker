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
  label: string;
}

export interface LanguageOptions {
  spoken: LanguageOption[];
  caption: LanguageOption[];
  /**
   * English never needs this — Whisper translates into it directly, in the
   * same pass that does the transcription. The other four go through a
   * translation service, so without it they cannot be delivered.
   */
  translation_available: boolean;
}
