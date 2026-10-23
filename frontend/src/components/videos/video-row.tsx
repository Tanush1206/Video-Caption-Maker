"use client";

import Link from "next/link";
import { Film } from "lucide-react";

import { AuthedImage } from "@/components/videos/authed-image";
import { VideoActions, useVideoMeta } from "@/components/videos/video-actions";
import { formatFileSize, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Video } from "@/types/video";

/**
 * One video, as a row whose bar is its length.
 *
 * The list view keeps the one dimension a grid of equal thumbnails throws
 * away: scanning the column tells you the composition of your library before
 * you have read a single filename. `scaleMs` is the longest video on the
 * page, passed in so every row shares one scale; the library states it above
 * the list.
 *
 * Rows are split by hairlines, with the same "…" actions as the grid.
 */
export function VideoRow({ video, scaleMs }: { video: Video; scaleMs: number }) {
  const meta = useVideoMeta(video);
  const isProcessing = video.status === "processing";
  const failed = video.status === "failed";

  const fill = isProcessing
    ? video.progress
    : video.duration_ms && scaleMs > 0
      ? // A floor, so a fifteen-second clip next to an hour-long recording is
        // still visibly there.
        Math.max(1.5, (video.duration_ms / scaleMs) * 100)
      : 0;

  return (
    <div className="group flex items-center gap-4 py-3">
      <Link
        href={`/editor/${video.id}`}
        className="relative flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2"
        tabIndex={-1}
        aria-hidden="true"
      >
        {video.has_thumbnail ? (
          <AuthedImage
            path={`/api/videos/${video.id}/thumbnail`}
            alt=""
            className="size-full object-cover"
            fallback={<Film className="size-4 text-muted-foreground" />}
          />
        ) : (
          <Film className="size-4 text-muted-foreground" />
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          href={`/editor/${video.id}`}
          className="block truncate text-[15px] font-semibold hover:underline hover:underline-offset-2"
          title={video.title}
        >
          {video.title}
        </Link>

        <p
          className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground"
          title={failed && video.error_message ? video.error_message : undefined}
        >
          {failed && <span className="size-2 shrink-0 rounded-full bg-destructive" aria-hidden="true" />}
          <span className="truncate">
            {[...meta, formatFileSize(video.size_bytes), formatRelativeTime(video.created_at)].join(" · ")}
          </span>
        </p>

        {/* The bar: its track is always full width so the rows keep one
            rhythm; only the fill carries the meaning. */}
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out",
              failed ? "bg-destructive" : video.status === "pending" ? "bg-muted-foreground/40" : "bar-fill"
            )}
            style={{ width: `${fill}%` }}
          />
        </div>
      </div>

      <VideoActions
        video={video}
        className="shrink-0 opacity-0 transition-opacity duration-200 ease-out focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      />
    </div>
  );
}
