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
  /** 0-100, meaningful only while status is "processing". */
  progress: number;
  /** "extracting" | "transcribing" | "embedding", or null when idle. */
  stage: string | null;
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
