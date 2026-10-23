"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useStats } from "@/hooks/use-stats";
import { formatDurationLong, formatFileSize } from "@/lib/format";

/**
 * The library's figures, as one grey line under the "Videos" heading
 * (v1.1.0): context for the library, not something to act on, so no tiles,
 * boxes or bars. Queued and failed counts appear only when there are any.
 */
export function StatsStrip() {
  const { data, isLoading, isError } = useStats();

  if (isLoading) return <Skeleton className="mt-1.5 h-4 w-72" />;
  if (isError || !data) return null;

  const inFlight = data.by_status.pending + data.by_status.processing;
  const parts = [
    `${data.videos} ${data.videos === 1 ? "video" : "videos"}`,
    `${formatDurationLong(data.duration_ms)} of footage`,
    `${data.captions.toLocaleString()} captions`,
    `${formatFileSize(data.storage_bytes)} stored`,
    ...(inFlight > 0 ? [`${inFlight} in the queue`] : []),
    ...(data.by_status.failed > 0 ? [`${data.by_status.failed} failed`] : []),
    `${formatFileSize(data.disk_free_bytes)} free on disk`,
  ];

  return <p className="mt-1 text-sm text-muted-foreground">{parts.join(" · ")}</p>;
}
