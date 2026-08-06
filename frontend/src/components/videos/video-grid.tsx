"use client";

import { Film } from "lucide-react";

import { VideoCard } from "@/components/videos/video-card";
import { useVideos } from "@/hooks/use-videos";

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
  const { data, isLoading, isError, error } = useVideos();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {/* Skeletons rather than a spinner: the layout doesn't jump when the
            real cards arrive. */}
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-500">
        Couldn&apos;t load your videos: {(error as Error).message}
      </p>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <Film className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-sm font-medium">No videos yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload one above to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {data.items.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
    </div>
  );
}
