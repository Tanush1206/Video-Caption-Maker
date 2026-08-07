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
