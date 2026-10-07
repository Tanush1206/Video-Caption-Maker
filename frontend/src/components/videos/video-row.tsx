"use client";

import Link from "next/link";
import { Film, Play, RefreshCw, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import { AuthedImage } from "@/components/videos/authed-image";
import { Button } from "@/components/ui/button";
import { useDeleteVideo, useRetranscribe } from "@/hooks/use-videos";
import { askToNotify, watchTranscription } from "@/lib/transcription-alerts";
import { formatDuration, formatFileSize, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Video, VideoStatus } from "@/types/video";

const STATUS: Record<VideoStatus, { label: string; className: string }> = {
  pending: { label: "Queued", className: "text-muted-foreground" },
  processing: { label: "Transcribing", className: "text-primary" },
  completed: { label: "Ready", className: "text-success" },
  failed: { label: "Failed", className: "text-destructive" },
};

// The stage name the worker writes is an internal token; give it a label a
// user can act on.
const STAGE_LABELS: Record<string, string> = {
  extracting: "Extracting audio",
  transcribing: "Transcribing speech",
  embedding: "Building search index",
};

/**
 * One video, as a row whose bar is its length.
 *
 * This replaces a card in a grid, and the reason is that a grid of equal
 * rectangles throws away the one dimension this app is about. Every tile
 * looked the same whether it held a thirty-second clip or an hour of
 * lecture — the thumbnail told you nothing about the thing you would actually
 * be working with, and duration was a caption in the corner you had to read
 * one at a time.
 *
 * Here length *is* the shape. Scanning the column tells you the composition of
 * your library before you have read a single filename.
 *
 * `scaleMs` is the longest video on the page, passed in rather than computed
 * here so every row shares one scale. The library states that reference above
 * the list; a bar chart whose axis is invisible is a decoration.
 */
export function VideoRow({ video, scaleMs }: { video: Video; scaleMs: number }) {
  const deleteVideo = useDeleteVideo();
  const retranscribe = useRetranscribe();
  const [confirming, setConfirming] = useState(false);

  const status = STATUS[video.status];
  const isProcessing = video.status === "processing";

  // While transcribing, the bar means progress — duration is often not even
  // known yet, since it is probed during extraction. Two different quantities
  // in one bar would be worse, so the label always says which one it is.
  const fill = isProcessing
    ? video.progress
    : video.duration_ms && scaleMs > 0
      ? // A floor, so a fifteen-second clip next to an hour-long recording is
        // still a visible mark rather than nothing at all.
        Math.max(1.5, (video.duration_ms / scaleMs) * 100)
      : 0;

  return (
    <div className="group border-b border-border/60 transition-colors last:border-b-0 hover:bg-surface-1">
      <div className="flex items-center gap-4 py-3 pl-2 pr-2">
        <Link
          href={`/editor/${video.id}`}
          className="relative flex h-11 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
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
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Play className="size-4 fill-white text-white" />
          </span>
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <Link
              href={`/editor/${video.id}`}
              className="min-w-0 flex-1 truncate text-body-md font-medium transition-colors hover:text-primary"
              title={video.title}
            >
              {video.title}
            </Link>

            <span className="shrink-0 font-mono text-mono-data tabular-nums text-muted-foreground">
              {isProcessing ? `${video.progress}%` : formatDuration(video.duration_ms)}
            </span>
          </div>

          {/* The bar. Its track is always full width so the row keeps a
              constant rhythm; only the fill carries the meaning. */}
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500 ease-out",
                video.status === "failed" ? "bg-destructive/60" : "bar-fill",
                video.status === "pending" && "bg-muted-foreground/30"
              )}
              style={{ width: `${fill}%` }}
            />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-body-sm text-muted-foreground">
            <span className={status.className}>
              {isProcessing && video.stage
                ? (STAGE_LABELS[video.stage] ?? video.stage)
                : status.label}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatFileSize(video.size_bytes)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatRelativeTime(video.created_at)}</span>

            {video.status === "failed" && video.error_message && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate text-destructive" title={video.error_message}>
                  {video.error_message}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Revealed on hover, but always present for keyboard and touch:
            focus-within keeps them reachable by Tab, and coarse pointers get
            them permanently since there is no hover to trigger. */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
          {(video.status === "failed" || video.status === "pending") && (
            <button
              type="button"
              // No language fields: this is the dashboard's "get it going"
              // button, so the video keeps whatever it was already set to.
              // Choosing a language belongs in the editor, beside the captions
              // it changes.
              //
              // No navigation either — this row *is* the dashboard. It still
              // asks to notify, because a job started here is just as long and
              // just as worth walking away from as one started in the editor.
              onClick={() => {
                askToNotify();
                retranscribe.mutate(
                  { id: video.id },
                  { onSuccess: () => watchTranscription(video.id) }
                );
              }}
              disabled={retranscribe.isPending}
              title={video.status === "failed" ? "Try again" : "Transcribe now"}
              aria-label={`Transcribe ${video.title}`}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("size-4", retranscribe.isPending && "animate-spin")} />
            </button>
          )}
          {video.status === "completed" && (
            <Link
              href={`/search/${video.id}`}
              title="Search this video"
              aria-label={`Search ${video.title}`}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Search className="size-4" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={deleteVideo.isPending}
            aria-label={`Delete ${video.title}`}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {confirming && (
        <div className="animate-fade-in flex flex-wrap items-center gap-3 border-t border-border bg-subtle px-2 py-3">
          <p className="text-body-sm">
            Delete <span className="font-medium">{video.title}</span>? This removes the
            file, its captions and any exports, and cannot be undone.
          </p>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              loading={deleteVideo.isPending}
              onClick={() =>
                deleteVideo.mutate(video.id, { onSettled: () => setConfirming(false) })
              }
            >
              {deleteVideo.isPending ? "Deleting…" : "Delete"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
