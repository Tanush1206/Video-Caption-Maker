"use client";

import { AlertCircle, ChevronLeft, ChevronRight, Film, SearchX } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoRow } from "@/components/videos/video-row";
import { PAGE_SIZE, useVideos } from "@/hooks/use-videos";
import { FEATURES } from "@/lib/features";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { VideoStatus } from "@/types/video";

const FILTERS: { label: string; value: VideoStatus | null }[] = [
  { label: "All", value: null },
  { label: "Ready", value: "completed" },
  { label: "Processing", value: "processing" },
  { label: "Failed", value: "failed" },
];

/**
 * What a brand-new account sees instead of an empty library.
 *
 * The three promises come from the same array the landing page renders. That
 * is the point: someone reads those lines, signs up, watches the confetti, and
 * arrives — and used to arrive at "No videos yet" and nothing else. Restating
 * the promise at the moment it starts being kept is the difference between an
 * empty state and a first run.
 */
function FirstRun() {
  return (
    <div className="border-y border-border py-14 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Film className="size-5" />
      </span>
      <p className="mt-4 text-h2">Nothing here yet</p>
      <p className="mx-auto mt-1.5 max-w-sm text-body-md text-muted-foreground">
        Drop a video in the bar above. Here is what happens to it.
      </p>

      <div className="mx-auto mt-10 grid max-w-3xl gap-6 text-left sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.title}>
            <feature.icon className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-2.5 text-body-md font-medium">{feature.title}</p>
            <p className="mt-1 text-body-sm leading-relaxed text-muted-foreground">
              {feature.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The library, read as time.
 *
 * Rows separated by hairlines rather than cards in a grid — see VideoRow for
 * why length is the bar. This component owns the one thing a row cannot know
 * on its own: the scale every bar is drawn against.
 */
export function VideoLibrary() {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<VideoStatus | null>(null);

  const { data, isLoading, isError, error, isPlaceholderData } = useVideos(page, status);

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Deleting the last video on the last page leaves the view stranded past the
  // end, showing an empty list over a non-zero total. Walk back instead.
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
            "rounded-full px-3 py-1.5 text-body-sm font-medium transition-colors",
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
        className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-md text-destructive"
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
        <div className="border-y border-border">
          {/* Shaped like the rows, so the layout doesn't jump when they land. */}
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border/60 py-3 last:border-b-0">
              <Skeleton className="h-11 w-20 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-1 w-full" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const items = data?.items ?? [];

  // One scale for every bar on the page. Taken from what is on screen rather
  // than from the whole library, because the API does not report a maximum —
  // which is exactly why the figure is printed above the list. A bar chart
  // with an unstated axis invites you to compare across pages, where the
  // comparison would not hold.
  const scaleMs = items.reduce((longest, video) => Math.max(longest, video.duration_ms ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {filters}

        {items.length > 0 && (
          <p className="text-body-sm text-muted-foreground">
            <span className="tabular-nums">{total}</span> video{total === 1 ? "" : "s"}
            {scaleMs > 0 && (
              <>
                {" · bar scale "}
                <span className="font-mono tabular-nums">{formatDuration(scaleMs)}</span>
              </>
            )}
          </p>
        )}
      </div>

      {items.length === 0 ? (
        // Two different nothings. "You have no videos" is an invitation; "no
        // videos match this filter" is a dead end with a way out, and showing
        // the first when someone filtered would read as data loss.
        status === null ? (
          <FirstRun />
        ) : (
          <div className="border-y border-border py-14 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <SearchX className="size-5" />
            </span>
            <p className="mt-4 text-body-md font-medium">Nothing matches this filter</p>
            <p className="mt-1 text-body-sm text-muted-foreground">
              No videos are in this state right now.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => changeFilter(null)}
            >
              Show all videos
            </Button>
          </div>
        )
      ) : (
        <div
          className={cn(
            "border-y border-border",
            // Dimmed while the next page is in flight, so the stale content on
            // screen doesn't read as the answer to what was just clicked.
            isPlaceholderData && "pointer-events-none opacity-50",
            "transition-opacity duration-200"
          )}
        >
          {items.map((video) => (
            <VideoRow key={video.id} video={video} scaleMs={scaleMs} />
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
          <span className="px-2 text-body-sm tabular-nums text-muted-foreground">
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
