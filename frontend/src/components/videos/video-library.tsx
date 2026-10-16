"use client";

import { AlertCircle, ChevronLeft, ChevronRight, LayoutGrid, List, Search, SearchX } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
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
    <div className="grid gap-4 md:grid-cols-3">
      {FIRST_STEPS.map((step) => (
        <div key={step.title} className="rounded-lg border border-border bg-card p-5">
          <p className="text-lg font-semibold tracking-tight">{step.title}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
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
    <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Filter by status">
      {FILTERS.map((filter) => (
        <button
          key={filter.label}
          type="button"
          onClick={() => changeFilter(filter.value)}
          aria-pressed={status === filter.value}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            status === filter.value
              ? "bg-surface-3 text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
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
        <span>Couldn&apos;t load your videos. {(error as Error).message}</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {filters}
        {/* Shaped like the cards, so the layout doesn't jump when they land. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-border bg-card">
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="space-y-2 p-3.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold tracking-tight">Recent projects</h2>
          <span className="rounded-md border border-border bg-card px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
            {total} video{total === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {filters}
          <label className="relative order-last flex w-full items-center sm:order-none sm:w-56">
            <Search
              className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="sr-only">Filter projects by name</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter projects…"
              className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:border-ring focus:outline-none"
            />
          </label>
          <div
            className="flex items-center rounded-lg border border-border bg-card p-0.5"
            role="group"
            aria-label="Layout"
          >
            {(
              [
                { value: "grid", label: "Grid view", icon: LayoutGrid },
                { value: "list", label: "List view", icon: List },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setView(option.value)}
                aria-pressed={view === option.value}
                aria-label={option.label}
                title={option.label}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md transition-colors",
                  view === option.value
                    ? "bg-surface-3 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <option.icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        // Two different nothings. "You have no videos" is an invitation; "no
        // videos match this filter" is a dead end with a way out, and showing
        // the first when someone filtered would read as data loss.
        needle ? (
          <div className="py-14 text-center">
            <p className="text-body-md font-medium">No project on this page has that name</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => setQuery("")}>
              Clear the filter
            </Button>
          </div>
        ) : status === null ? (
          <FirstRun />
        ) : (
          <div className="py-14 text-center">
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
            // Dimmed while the next page is in flight, so the stale content on
            // screen doesn't read as the answer to what was just clicked.
            isPlaceholderData && "pointer-events-none opacity-50",
            "transition-opacity duration-200"
          )}
        >
          {view === "grid" ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((video) => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card px-2">
              {scaleMs > 0 && (
                <p className="border-b border-border px-2 py-2 text-right text-body-sm text-muted-foreground">
                  Bar scale <span className="font-mono tabular-nums">{formatDuration(scaleMs)}</span>
                </p>
              )}
              {items.map((video) => (
                <VideoRow key={video.id} video={video} scaleMs={scaleMs} />
              ))}
            </div>
          )}
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
