import type { VideoStatus } from "@/types/video";

export interface Stats {
  videos: number;
  /** Every status is present even at zero, so no key is ever missing. */
  by_status: Record<VideoStatus, number>;
  storage_bytes: number;
  duration_ms: number;
  captions: number;
  exports: number;
  /**
   * Free and total space on the host disk, shared by everyone — not a
   * per-user quota. Label it as the machine's, never as an allowance.
   */
  disk_free_bytes: number;
  disk_total_bytes: number;
}
