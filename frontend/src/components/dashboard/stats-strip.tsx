"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useStats } from "@/hooks/use-stats";
import { formatFileSize } from "@/lib/format";

/**
 * The library's figures, as one grey line under the "Videos" heading:
 * "6 videos · 1.2 GB" (v1.1.0). Footage, captions, the queue and free disk
 * are in Settings → Storage.
 */
export function StatsStrip() {
  const { data, isLoading, isError } = useStats();

  // As tall as the line it stands for (mt-1 + 20 px), so nothing moves.
  if (isLoading) return <Skeleton className="mt-1 h-5 w-32" />;
  if (isError || !data) return null;

  return (
    <p className="mt-1 text-sm text-muted-foreground">
      {data.videos} {data.videos === 1 ? "video" : "videos"} · {formatFileSize(data.storage_bytes)}
    </p>
  );
}
