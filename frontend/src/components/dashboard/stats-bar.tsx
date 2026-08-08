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
  hint,
}: {
  icon: typeof Film;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="p-3.5 sm:p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-3.5" />
        </span>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>

      <p className="mt-2.5 text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>

      {/* Reserved even when empty, so tiles in a row stay the same height and
          the grid doesn't jog as counts change. */}
      <p className="mt-0.5 h-4 truncate text-xs text-muted-foreground">{hint ?? ""}</p>
    </Card>
  );
}

export function StatsBar() {
  const { data, isLoading, isError } = useStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="p-3.5 sm:p-4">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="mt-2.5 h-7 w-16" />
            <Skeleton className="mt-1 h-3 w-20" />
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
