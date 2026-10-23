"use client";

import { AlertCircle, ChevronLeft, ChevronRight, LayoutGrid, List, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { StatsStrip } from "@/components/dashboard/stats-strip";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoCard } from "@/components/videos/video-card";
import { VideoRow } from "@/components/videos/video-row";
import { PAGE_SIZE, useVideos } from "@/hooks/use-videos";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { VideoStatus } from "@/types/video";

const FILTERS: { label: string; value: VideoStatus | null }[] = [
  { label: "All", value: null },
  { label: "Ready", value: "completed" },
  { label: "Processing", value: "processing" },
  { label: "Failed", value: "failed" },
];

const FIRST_STEPS = [
  {
    title: "1. Drop your video",
    body: "Add a video file from your computer. It stays on this machine.",
  },
  {
    title: "2. Pick a language",
    body: "Captions in the language that is spoken, or translated into another one on this computer.",
  },
  {
    title: "3. Export",
    body: "Download SRT or VTT subtitles, or an MP4 with the captions burned in.",
  },
] as const;

/**
 * What a new install shows instead of an empty library: the three steps the
 * panel above starts, so the first visit explains the whole flow.
 */
function FirstRun() {
  return (
    <div className="grid gap-8 md:grid-cols-3">
      {FIRST_STEPS.map((step) => (
        <div key={step.title}>
          <p className="text-[15px] font-semibold">{step.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
        </div>
      ))}
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
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");

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
    <Segmented
      label="Filter by status"
      segments={FILTERS.map((filter) => ({ value: filter.value, label: filter.label }))}
      value={status}
      onChange={changeFilter}
      className="w-full sm:w-auto"
    />
  );

  if (isError) {
    return (
      <p role="alert" className="flex gap-2 text-[15px] text-destructive">
        <AlertCircle className="mt-0.5 size-[18px] shrink-0" />
        <span>Couldn&apos;t load your videos. {(error as Error).message}</span>
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        {filters}
        {/* Shaped like the cards, so the layout doesn't jump when they land. */}
        <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // A new install: no library to filter yet, just the steps.
  if (total === 0 && status === null && !isPlaceholderData) return <FirstRun />;

  const allItems = data?.items ?? [];
  // A name filter over the page on screen. The status tabs are the
  // server-side filter; this one narrows what is already loaded.
  const needle = query.trim().toLowerCase();
  const items = needle
    ? allItems.filter((video) => video.title.toLowerCase().includes(needle))
    : allItems;

  // One scale for every bar on the page. Taken from what is on screen rather
  // than from the whole library, because the API does not report a maximum —
  // which is exactly why the figure is printed above the list. A bar chart
  // with an unstated axis invites you to compare across pages, where the
  // comparison would not hold.
  const scaleMs = items.reduce((longest, video) => Math.max(longest, video.duration_ms ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Videos</h2>
          {/* The library's figures, as one grey line. */}
          <StatsStrip />
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          {filters}
          <label className="relative flex w-full min-w-0 flex-1 items-center sm:w-56 sm:flex-none">
            <Search
              className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="sr-only">Filter projects by name</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name"
              className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-[15px] placeholder:text-muted-foreground focus-visible:border-ring sm:h-8 sm:text-sm"
            />
          </label>
          <Segmented
            label="Layout"
            iconOnly
            segments={[
              { value: "grid" as const, label: "Grid view", icon: LayoutGrid },
              { value: "list" as const, label: "List view", icon: List },
            ]}
            value={view}
            onChange={setView}
            segmentClassName="px-2.5"
          />
        </div>
      </div>

      {items.length === 0 ? (
        // Two different nothings. "You have no videos" is an invitation; "no
        // videos match this filter" is a dead end with a way out, and showing
        // the first when someone filtered would read as data loss.
        needle ? (
          <div className="py-16 text-center">
            <p className="text-[15px] font-semibold">No video on this page has that name</p>
            <Button variant="plain" size="sm" className="mt-2" onClick={() => setQuery("")}>
              Clear the filter
            </Button>
          </div>
        ) : status === null ? (
          <FirstRun />
        ) : (
          <div className="py-16 text-center">
            <p className="text-[15px] font-semibold">Nothing matches this filter</p>
            <p className="mt-1 text-sm text-muted-foreground">No videos are in this state right now.</p>
            <Button variant="plain" size="sm" className="mt-2" onClick={() => changeFilter(null)}>
              Show all videos
            </Button>
          </div>
        )
      ) : (
        <div
          className={cn(
            // Dimmed while the next page is in flight, so the stale content on
            // screen doesn't read as the answer to what was just clicked.
            isPlaceholderData && "pointer-events-none opacity-50",
            "transition-opacity duration-200"
          )}
        >
          {view === "grid" ? (
            <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((video) => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          ) : (
            <div>
              {scaleMs > 0 && (
                <p className="pb-2 text-right text-sm text-muted-foreground">
                  Bar scale <span className="font-mono tabular-nums">{formatDuration(scaleMs)}</span>
                </p>
              )}
              <div className="divide-y divide-border border-y border-border">
                {items.map((video) => (
                  <VideoRow key={video.id} video={video} scaleMs={scaleMs} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <span className="px-2 text-sm tabular-nums text-muted-foreground">
            Page {page + 1} of {pageCount}
          </span>
          <Button
            variant="ghost"
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
