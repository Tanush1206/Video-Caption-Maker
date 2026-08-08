"use client";

import Link from "next/link";
import { Film, Play, RefreshCw, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import { AuthedImage } from "@/components/videos/authed-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useDeleteVideo, useRetranscribe } from "@/hooks/use-videos";
import { cn } from "@/lib/utils";
import { formatDuration, formatFileSize, formatRelativeTime } from "@/lib/format";
import type { Video, VideoStatus } from "@/types/video";

type Tone = "neutral" | "primary" | "success" | "warning" | "destructive";

const STATUS: Record<VideoStatus, { label: string; tone: Tone; live?: boolean }> = {
  pending: { label: "Queued", tone: "neutral", live: true },
  processing: { label: "Transcribing", tone: "primary", live: true },
  completed: { label: "Ready", tone: "success" },
  failed: { label: "Failed", tone: "destructive" },
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

  const status = STATUS[video.status];

  return (
    <Card interactive className="group overflow-hidden">
      <Link href={`/editor/${video.id}`} className="block">
        <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-muted">
          {video.has_thumbnail ? (
            <AuthedImage
              path={`/api/videos/${video.id}/thumbnail`}
              alt=""
              // Scaling the still on hover makes the card feel like a video
              // rather than a row in a table.
              className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
              fallback={<Film className="size-8 text-muted-foreground" />}
            />
          ) : (
            <Film className="size-8 text-muted-foreground" />
          )}

          {/* Scrim behind the corner chips. Without it, a light thumbnail
              leaves white-on-white text unreadable. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/25 opacity-80"
          />

          <span className="absolute left-2 top-2">
            <Badge
              tone={status.tone}
              dot={status.live}
              pulse={video.status === "processing"}
              // Fixed dark chrome, not theme tokens: this sits on an arbitrary
              // video frame, where a theme-coloured pill can vanish entirely.
              className="border border-white/15 bg-black/55 text-white backdrop-blur-sm"
            >
              {status.label}
            </Badge>
          </span>

          {video.duration_ms !== null && (
            <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
              {formatDuration(video.duration_ms)}
            </span>
          )}

          <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <span className="flex size-11 items-center justify-center rounded-full bg-white/95 shadow-overlay">
              <Play className="size-5 translate-x-px fill-black text-black" />
            </span>
          </span>
        </div>
      </Link>

      <div className="p-3">
        <div className="flex items-start gap-1">
          <Link href={`/editor/${video.id}`} className="min-w-0 flex-1">
            {/* title attribute so a truncated name is still readable on hover */}
            <p
              className="truncate text-sm font-medium transition-colors group-hover:text-primary"
              title={video.title}
            >
              {video.title}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatFileSize(video.size_bytes)} · {formatRelativeTime(video.created_at)}
            </p>
          </Link>

          {/* Revealed on hover, but always present for keyboard and touch:
              focus-within keeps them reachable by Tab, and coarse pointers get
              them permanently since there is no hover to trigger. */}
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
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

        {video.status === "processing" && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {video.stage ? (STAGE_LABELS[video.stage] ?? video.stage) : "Starting"}
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {video.progress}%
              </span>
            </div>
            <div
              className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={video.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500 ease-out"
                style={{ width: `${video.progress}%` }}
              />
            </div>
          </div>
        )}

        {video.status === "failed" && (
          <div className="mt-3 rounded-md bg-destructive/10 p-2">
            {video.error_message && (
              <p className="text-xs text-destructive" title={video.error_message}>
                {video.error_message}
              </p>
            )}
            <button
              type="button"
              onClick={() => retranscribe.mutate(video.id)}
              disabled={retranscribe.isPending}
              className="mt-1 flex items-center gap-1.5 text-xs font-medium text-destructive hover:underline disabled:opacity-60"
            >
              <RefreshCw className={cn("size-3", retranscribe.isPending && "animate-spin")} />
              Try again
            </button>
          </div>
        )}

        {video.status === "pending" && (
          <button
            type="button"
            onClick={() => retranscribe.mutate(video.id)}
            disabled={retranscribe.isPending}
            className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-60"
          >
            <RefreshCw className={cn("size-3", retranscribe.isPending && "animate-spin")} />
            Transcribe now
          </button>
        )}
      </div>

      {confirming && (
        <div className="animate-fade-in border-t border-border bg-subtle p-3">
          <p className="text-sm font-medium">Delete “{video.title}”?</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This removes the file, its captions, and any exports. It cannot be undone.
          </p>
          <div className="mt-3 flex gap-2">
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
    </Card>
  );
}
