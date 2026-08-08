"use client";

import { Clock, Film, HardDrive, Subtitles } from "lucide-react";

import { useStats } from "@/hooks/use-stats";
import { formatDurationLong, formatFileSize } from "@/lib/format";

function Tile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Film;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3 sm:p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SkeletonTile() {
  return (
    <div className="rounded-lg border border-border p-3 sm:p-4">
      <div className="h-3 w-16 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-6 w-12 animate-pulse rounded bg-muted" />
    </div>
  );
}

export function StatsBar() {
  const { data, isLoading, isError } = useStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonTile key={i} />
        ))}
      </div>
    );
  }

  // Counters are decoration, not the job. A failed stats call must not take
  // the library down with it, so this renders nothing and the grid below
  // carries on.
  if (isError || !data) return null;

  const inFlight = data.by_status.pending + data.by_status.processing;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        icon={Film}
        label="Videos"
        value={String(data.videos)}
        hint={
          inFlight > 0
            ? `${inFlight} in the queue`
            : data.by_status.failed > 0
              ? `${data.by_status.failed} failed`
              : undefined
        }
      />
      <Tile
        icon={Clock}
        label="Footage"
        value={formatDurationLong(data.duration_ms)}
      />
      <Tile
        icon={Subtitles}
        label="Captions"
        value={data.captions.toLocaleString()}
        hint={data.exports > 0 ? `${data.exports} exports` : undefined}
      />
      <Tile
        icon={HardDrive}
        label="Storage used"
        value={formatFileSize(data.storage_bytes)}
        // Deliberately worded as the machine's free space, not an allowance:
        // it is the host disk, shared by every account, and there are no
        // quotas. Calling it "remaining" would promise something we don't have.
        hint={`${formatFileSize(data.disk_free_bytes)} free on disk`}
      />
    </div>
  );
}
