"use client";

import { AlertCircle, ChevronLeft, ChevronRight, Film, SearchX } from "lucide-react";
import { useEffect, useState } from "react";

import { VideoCard } from "@/components/videos/video-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_SIZE, useVideos } from "@/hooks/use-videos";
import { cn } from "@/lib/utils";
import type { VideoStatus } from "@/types/video";

const FILTERS: { label: string; value: VideoStatus | null }[] = [
  { label: "All", value: null },
  { label: "Ready", value: "completed" },
  { label: "Processing", value: "processing" },
  { label: "Failed", value: "failed" },
];

const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

function SkeletonCard() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-video rounded-none" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </Card>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Film;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-subtle px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <p className="mt-4 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function VideoGrid() {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<VideoStatus | null>(null);

  const { data, isLoading, isError, error, isPlaceholderData } = useVideos(page, status);

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Deleting the last video on the last page leaves the view stranded past the
  // end, showing an empty grid over a non-zero total. Walk back instead.
  useEffect(() => {
    if (!isPlaceholderData && page > 0 && page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount, isPlaceholderData]);

  function changeFilter(value: VideoStatus | null) {
    setStatus(value);
    // Page 3 of "all" is rarely page 3 of "failed", and is often past the end
    // of it entirely.
    setPage(0);
  }

  const filters = (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
      {FILTERS.map((filter) => (
        <button
          key={filter.label}
          type="button"
          onClick={() => changeFilter(filter.value)}
          aria-pressed={status === filter.value}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            status === filter.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );

  if (isError) {
    return (
      <div
        role="alert"
        className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        <AlertCircle className="mt-px size-4 shrink-0" />
        <span>Couldn&apos;t load your videos: {(error as Error).message}</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {filters}
        <div className={GRID}>
          {/* Skeletons rather than a spinner: the layout doesn't jump when the
              real cards arrive. */}
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {filters}
        {total > 0 && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {total} video{total === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {items.length === 0 ? (
        // Two different nothings. "You have no videos" is an invitation;
        // "no videos match this filter" is a dead end with a way out, and
        // showing the first when someone filtered would read as data loss.
        status === null ? (
          <EmptyState
            icon={Film}
            title="No videos yet"
            body="Upload one above and it'll be transcribed automatically."
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title="Nothing matches this filter"
            body="No videos are in this state right now."
            action={
              <Button variant="secondary" size="sm" onClick={() => changeFilter(null)}>
                Show all videos
              </Button>
            }
          />
        )
      ) : (
        <div
          className={cn(
            GRID,
            // Dimmed while the next page is in flight, so the stale content on
            // screen doesn't read as the answer to what was just clicked.
            isPlaceholderData && "pointer-events-none opacity-50",
            "transition-opacity duration-200"
          )}
        >
          {items.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="secondary"
            size="icon-sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <span className="px-2 text-xs tabular-nums text-muted-foreground">
            Page {page + 1} of {pageCount}
          </span>
          <Button
            variant="secondary"
            size="icon-sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page + 1 >= pageCount}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
