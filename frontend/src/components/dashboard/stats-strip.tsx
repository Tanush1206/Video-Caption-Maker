"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useStats } from "@/hooks/use-stats";
import { formatDurationLong, formatFileSize } from "@/lib/format";

/**
 * The library's figures, set as type rather than boxed in tiles.
 *
 * These were four cards in a row. Four rectangles above a page of rectangles
 * is a lot of chrome to read four numbers through, and the cards claimed a
 * visual weight the numbers do not have — none of them is something you act
 * on, they are context for the library underneath.
 *
 * So: one line, numbers in mono at a size you can scan without stopping. The
 * hairlines it used to draw for itself are gone — it sits inside a glass panel
 * that already has edges, and a rule immediately inside a border reads as a
 * seam. No boxes, no fills, no icons. The disk bar is the one thing here with a
 * shape, because it is the one figure that is a proportion rather than a
 * count.
 */
function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-xl font-semibold tabular-nums">{value}</span>
      <span className="label-caps">{label}</span>
    </div>
  );
}

export function StatsStrip() {
  const { data, isLoading, isError } = useStats();

  if (isLoading) {
    return (
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-28" />
        ))}
      </div>
    );
  }

  // Counters are context, not the job. A failed stats call must not take the
  // library down with it, so this renders nothing and the list carries on.
  if (isError || !data) return null;

  const inFlight = data.by_status.pending + data.by_status.processing;

  // How full the *disk* is, which is a fact we actually have. There are no
  // per-account quotas here, so the bar tracks the machine and the label says
  // so. A bar that invents an allowance is worse than no bar.
  const diskUsed = data.disk_total_bytes - data.disk_free_bytes;
  const diskPercent =
    data.disk_total_bytes > 0 ? Math.round((diskUsed / data.disk_total_bytes) * 100) : 0;

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <Figure value={String(data.videos)} label={data.videos === 1 ? "video" : "videos"} />
      <Figure value={formatDurationLong(data.duration_ms)} label="footage" />
      <Figure value={data.captions.toLocaleString()} label="captions" />
      <Figure value={formatFileSize(data.storage_bytes)} label="stored" />

      {/* Only when there is something to say. A permanent "0 in the queue"
          is noise on every page load. */}
      {inFlight > 0 && (
        <span className="flex items-center gap-2 text-body-sm text-primary">
          <span className="relative flex size-1.5" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
          </span>
          {inFlight} in the queue
        </span>
      )}

      {data.by_status.failed > 0 && (
        <span className="text-body-sm text-destructive">
          {data.by_status.failed} failed
        </span>
      )}

      <div className="ml-auto flex min-w-48 items-center gap-3">
        <span className="label-caps shrink-0">disk</span>
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuenow={diskPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Host disk usage"
        >
          <div className="bar-fill h-full rounded-full" style={{ width: `${diskPercent}%` }} />
        </div>
        <span className="shrink-0 font-mono text-body-sm tabular-nums text-muted-foreground">
          {formatFileSize(data.disk_free_bytes)} free
        </span>
      </div>
    </div>
  );
}
