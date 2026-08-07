"use client";

import Link from "next/link";
import { Film, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { AuthedImage } from "@/components/videos/authed-image";
import { useDeleteVideo, useRetranscribe } from "@/hooks/use-videos";
import { cn } from "@/lib/utils";
import { formatDuration, formatFileSize, formatRelativeTime } from "@/lib/format";
import type { Video, VideoStatus } from "@/types/video";

const STATUS_STYLES: Record<VideoStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  processing: "bg-blue-500/15 text-blue-500",
  completed: "bg-green-500/15 text-green-600 dark:text-green-400",
  failed: "bg-red-500/15 text-red-500",
};

const STATUS_LABELS: Record<VideoStatus, string> = {
  pending: "Queued",
  processing: "Transcribing…",
  completed: "Ready",
  failed: "Failed",
};

// The stage name the worker writes is an internal token; give it a label a
// user can act on.
const STAGE_LABELS: Record<string, string> = {
  extracting: "Extracting audio",
  transcribing: "Transcribing speech",
  embedding: "Building search index",
};

export function VideoCard({ video }: { video: Video }) {
  const deleteVideo = useDeleteVideo();
  const retranscribe = useRetranscribe();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="group overflow-hidden rounded-lg border border-border transition hover:border-muted-foreground/40">
      <Link href={`/editor/${video.id}`} className="block">
        <div className="relative flex aspect-video items-center justify-center bg-muted">
          {video.has_thumbnail ? (
            <AuthedImage
              path={`/api/videos/${video.id}/thumbnail`}
              alt=""
              className="h-full w-full object-cover"
              fallback={<Film className="h-8 w-8 text-muted-foreground" />}
            />
          ) : (
            <Film className="h-8 w-8 text-muted-foreground" />
          )}

          {video.duration_ms !== null && (
            <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white">
              {formatDuration(video.duration_ms)}
            </span>
          )}
        </div>
      </Link>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/editor/${video.id}`} className="min-w-0 flex-1">
            {/* title attribute so a truncated name is still readable on hover */}
            <p className="truncate text-sm font-medium" title={video.title}>
              {video.title}
            </p>
          </Link>

          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={deleteVideo.isPending}
            className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-red-500 focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
            aria-label={`Delete ${video.title}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          {formatFileSize(video.size_bytes)} · {formatRelativeTime(video.created_at)}
        </p>

        <span
          className={cn(
            "mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium",
            STATUS_STYLES[video.status]
          )}
        >
          {STATUS_LABELS[video.status]}
        </span>

        {video.status === "processing" && (
          <div className="mt-2">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={video.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${video.progress}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {video.stage ? (STAGE_LABELS[video.stage] ?? video.stage) : "Starting"} ·{" "}
              {video.progress}%
            </p>
          </div>
        )}

        {video.status === "failed" && (
          <div className="mt-2">
            {video.error_message && (
              <p className="text-xs text-red-500" title={video.error_message}>
                {video.error_message}
              </p>
            )}
            <button
              type="button"
              onClick={() => retranscribe.mutate(video.id)}
              disabled={retranscribe.isPending}
              className="mt-1 flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-60"
            >
              <RefreshCw className={cn("h-3 w-3", retranscribe.isPending && "animate-spin")} />
              Retry
            </button>
          </div>
        )}

        {video.status === "pending" && (
          <button
            type="button"
            onClick={() => retranscribe.mutate(video.id)}
            disabled={retranscribe.isPending}
            className="mt-2 flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3 w-3", retranscribe.isPending && "animate-spin")} />
            Transcribe now
          </button>
        )}
      </div>

      {confirming && (
        <div className="border-t border-border bg-muted/50 p-3">
          <p className="text-sm">Delete “{video.title}”?</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This removes the file and any captions. It cannot be undone.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => deleteVideo.mutate(video.id, { onSettled: () => setConfirming(false) })}
              disabled={deleteVideo.isPending}
              className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {deleteVideo.isPending ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
