"use client";

import { ChevronLeft, ChevronRight, Film, SearchX } from "lucide-react";
import { useEffect, useState } from "react";

import { VideoCard } from "@/components/videos/video-card";
import { PAGE_SIZE, useVideos } from "@/hooks/use-videos";
import { cn } from "@/lib/utils";
import type { VideoStatus } from "@/types/video";

const FILTERS: { label: string; value: VideoStatus | null }[] = [
  { label: "All", value: null },
  { label: "Ready", value: "completed" },
  { label: "Processing", value: "processing" },
  { label: "Failed", value: "failed" },
];

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="aspect-video animate-pulse bg-muted" />
      <div className="space-y-2 p-3">
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      </div>
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
    <div className="flex flex-wrap gap-1.5">
      {FILTERS.map((filter) => (
        <button
          key={filter.label}
          type="button"
          onClick={() => changeFilter(filter.value)}
          aria-pressed={status === filter.value}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition",
            status === filter.value
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:bg-muted"
          )}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );

  if (isError) {
    return (
      <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-500">
        Couldn&apos;t load your videos: {(error as Error).message}
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {filters}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
          <p className="text-xs text-muted-foreground">
            {total} video{total === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {items.length === 0 ? (
        // Two different nothings. "You have no videos" is an invitation;
        // "no videos match this filter" is a dead end with a way out, and
        // showing the first when someone filtered would read as data loss.
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          {status === null ? (
            <>
              <Film className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">No videos yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload one above to get started.
              </p>
            </>
          ) : (
            <>
              <SearchX className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">Nothing matches this filter</p>
              <button
                type="button"
                onClick={() => changeFilter(null)}
                className="mt-2 text-sm text-primary hover:underline"
              >
                Show all videos
              </button>
            </>
          )}
        </div>
      ) : (
        <div
          className={cn(
            "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
            // Dimmed while the next page is in flight, so the stale content on
            // screen doesn't read as the answer to what was just clicked.
            isPlaceholderData && "opacity-60 transition-opacity"
          )}
        >
          {items.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous page"
            className="rounded-md border border-border p-1.5 transition hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs tabular-nums text-muted-foreground">
            Page {page + 1} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={page + 1 >= pageCount}
            aria-label="Next page"
            className="rounded-md border border-border p-1.5 transition hover:bg-muted disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
