"use client";

import { Clock, Film, HardDrive, Subtitles } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStats } from "@/hooks/use-stats";
import { formatDurationLong, formatFileSize } from "@/lib/format";

function Tile({
  icon: Icon,
  label,
  value,
  unit,
  hint,
}: {
  icon: typeof Film;
  label: string;
  value: string;
  /** Shown small beside the value — "GB", "captions". Keeps the number big. */
  unit?: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      {/* Label left, icon right — the Stitch instrument-panel arrangement.
          The icon is a quiet marker here, not a feature badge. */}
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="label-caps">{label}</span>
        <Icon className="size-4" />
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
          {value}
        </span>
        {unit && <span className="text-body-sm text-muted-foreground">{unit}</span>}
      </div>

      {/* Reserved even when empty, so tiles in a row stay the same height and
          the grid doesn't jog as counts change. */}
      <p className="mt-0.5 h-4 truncate text-body-sm text-muted-foreground">{hint ?? ""}</p>
    </Card>
  );
}

export function StatsBar() {
  const { data, isLoading, isError } = useStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-8 w-16" />
            <Skeleton className="mt-1 h-4 w-20" />
          </Card>
        ))}
      </div>
    );
  }

  // Counters are decoration, not the job. A failed stats call must not take
  // the library down with it, so this renders nothing and the grid below
  // carries on.
  if (isError || !data) return null;

  const inFlight = data.by_status.pending + data.by_status.processing;

  // How full the *disk* is, which is a fact we actually have. Stitch drew this
  // bar as "412 GB / 1TB", implying a per-account allowance; there are no
  // quotas here, so the bar tracks the machine and the label says so. A bar
  // that invents a limit is worse than no bar.
  const diskUsed = data.disk_total_bytes - data.disk_free_bytes;
  const diskPercent =
    data.disk_total_bytes > 0 ? Math.round((diskUsed / data.disk_total_bytes) * 100) : 0;

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
      <Tile icon={Clock} label="Footage" value={formatDurationLong(data.duration_ms)} />
      <Tile
        icon={Subtitles}
        label="Captions"
        value={data.captions.toLocaleString()}
        hint={data.exports > 0 ? `${data.exports} exports` : undefined}
      />

      <Card className="p-4">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="label-caps">Storage used</span>
          <HardDrive className="size-4" />
        </div>

        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
            {formatFileSize(data.storage_bytes)}
          </span>
        </div>

        <div
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuenow={diskPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Host disk usage"
        >
          <div className="bar-fill h-full rounded-full" style={{ width: `${diskPercent}%` }} />
        </div>

        <p className="mt-1 truncate text-body-sm text-muted-foreground">
          Disk {diskPercent}% full · {formatFileSize(data.disk_free_bytes)} free
        </p>
      </Card>
    </div>
  );
}
