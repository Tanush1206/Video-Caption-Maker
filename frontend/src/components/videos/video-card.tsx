"use client";

import Link from "next/link";
import { AlertTriangle, Film, FolderOpen, Loader2, RefreshCw, Search, Settings, Trash2 } from "lucide-react";
import { useState } from "react";

import { AuthedImage } from "@/components/videos/authed-image";
import { Button } from "@/components/ui/button";
import { useDeleteVideo, useLanguageOptions, useRetranscribe } from "@/hooks/use-videos";
import { formatDuration } from "@/lib/format";
import { stageLabel } from "@/lib/stages";
import { askToNotify, watchTranscription } from "@/lib/transcription-alerts";
import { cn } from "@/lib/utils";
import type { Video, VideoStatus } from "@/types/video";

const STATUS: Record<VideoStatus, { label: string; className: string }> = {
  pending: { label: "Queued", className: "border-border bg-black/70 text-zinc-200" },
  processing: { label: "Processing", className: "border-primary/40 bg-indigo-950/80 text-indigo-200" },
  completed: { label: "Ready", className: "border-emerald-500/40 bg-emerald-950/80 text-emerald-200" },
  failed: { label: "Failed", className: "border-rose-500/40 bg-rose-950/80 text-rose-200" },
};

/** "Auto-detect → Hindi", from the labels the API serves for each code. */
export function useLanguagePair(video: Video): { spoken: string; caption: string } | null {
  const { data } = useLanguageOptions();
  if (!data) return null;
  const spoken = data.spoken.find((o) => o.code === video.spoken_language)?.label ?? video.spoken_language;
  const caption =
    video.caption_language === "same"
      ? "Same language"
      : (data.caption.find((o) => o.code === video.caption_language)?.label ?? video.caption_language);
  return { spoken, caption };
}

/**
 * One project in the grid: thumbnail with its length and state over it, the
 * name and language pair, and what can be done with it now.
 *
 * The status chip and duration sit on the thumbnail, so they are drawn on a
 * fixed dark scrim in both themes; that is why they use literal colours
 * rather than the theme tokens.
 */
export function VideoCard({ video }: { video: Video }) {
  const deleteVideo = useDeleteVideo();
  const retranscribe = useRetranscribe();
  const languages = useLanguagePair(video);
  const [confirming, setConfirming] = useState(false);

  const status = STATUS[video.status];
  const working = video.status === "processing" || video.status === "pending";
  const failed = video.status === "failed";

  function retry() {
    // Same as the list row: keep the video's languages, ask to notify on the
    // click (browsers only prompt in response to one), and watch the job.
    askToNotify();
    retranscribe.mutate({ id: video.id }, { onSuccess: () => watchTranscription(video.id) });
  }

  return (
    <article
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border bg-card transition-colors",
        failed ? "border-destructive/30 hover:border-destructive/60" : "border-border hover:border-input"
      )}
    >
      <Link
        href={`/editor/${video.id}`}
        tabIndex={-1}
        aria-hidden="true"
        className="relative block aspect-video w-full overflow-hidden bg-black"
      >
        {video.has_thumbnail ? (
          <AuthedImage
            path={`/api/videos/${video.id}/thumbnail`}
            alt=""
            className={cn(
              "size-full object-cover transition-transform duration-300 group-hover:scale-105",
              (working || failed) && "opacity-40"
            )}
            fallback={<Film className="m-auto size-6 text-zinc-500" />}
          />
        ) : (
          <span className="flex size-full items-center justify-center">
            <Film className="size-6 text-zinc-500" />
          </span>
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

        {working && (
          <span className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
            <span className="mb-2 font-mono text-xs font-medium text-indigo-200">{stageLabel(video)}</span>
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <span
                className="block h-full rounded-full bg-indigo-500 transition-[width] duration-500"
                style={{ width: `${video.status === "processing" ? video.progress : 0}%` }}
              />
            </span>
            {video.status === "processing" && (
              <span className="mt-2 font-mono text-[11px] tabular-nums text-zinc-300">
                {video.progress}% complete
              </span>
            )}
          </span>
        )}

        {failed && (
          <span className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
            <AlertTriangle className="mb-1 size-6 text-rose-400" />
            <span className="font-mono text-xs font-medium text-rose-200">Couldn&apos;t finish</span>
          </span>
        )}

        {video.duration_ms != null && (
          <span className="absolute left-2 top-2 rounded-sm bg-black/70 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-zinc-100">
            {formatDuration(video.duration_ms)}
          </span>
        )}
        <span
          className={cn(
            "absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[11px]",
            status.className
          )}
        >
          <span
            className={cn("size-1.5 rounded-full bg-current", video.status === "processing" && "animate-pulse")}
            aria-hidden="true"
          />
          {video.status === "processing" ? `${status.label} ${video.progress}%` : status.label}
        </span>
      </Link>

      <div className="flex flex-1 flex-col justify-between gap-3 p-3.5">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold" title={video.title}>
            <Link href={`/editor/${video.id}`} className="hover:text-primary">
              {video.title}
            </Link>
          </h3>
          {failed && video.error_message ? (
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-destructive" title={video.error_message}>
              {video.error_message}
            </p>
          ) : (
            languages && (
              <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
                <span>{languages.spoken}</span>
                <span aria-hidden="true">→</span>
                <span className="sr-only">captions in</span>
                <span className="font-medium text-primary">{languages.caption}</span>
              </p>
            )
          )}
        </div>

        {confirming ? (
          <div className="animate-fade-in border-t border-border pt-3">
            <p className="text-xs">
              Delete <span className="font-medium">{video.title}</span>? Its captions and exports go
              too. This can&apos;t be undone.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                loading={deleteVideo.isPending}
                onClick={() => deleteVideo.mutate(video.id, { onSettled: () => setConfirming(false) })}
              >
                {deleteVideo.isPending ? "Deleting…" : "Delete"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 border-t border-border pt-3">
            {video.status === "completed" && (
              <Link
                href={`/editor/${video.id}`}
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <FolderOpen className="size-3.5" aria-hidden="true" />
                Open
              </Link>
            )}
            {working && (
              <Link
                href={`/editor/${video.id}`}
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-surface-2 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                {video.status === "pending" ? "Queued…" : "Processing…"}
              </Link>
            )}
            {(failed || video.status === "pending") && (
              <button
                type="button"
                onClick={retry}
                disabled={retranscribe.isPending}
                aria-label={`Transcribe ${video.title}`}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 text-xs font-medium transition-colors hover:bg-surface-3 disabled:opacity-50"
              >
                <RefreshCw className={cn("size-3.5", retranscribe.isPending && "animate-spin")} aria-hidden="true" />
                {failed ? "Retry" : "Start"}
              </button>
            )}
            {failed && (
              <Link
                href="/settings"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 text-xs font-medium transition-colors hover:bg-surface-3"
              >
                <Settings className="size-3.5" aria-hidden="true" />
                Settings
              </Link>
            )}

            <span className="ml-auto flex items-center">
              {video.status === "completed" && (
                <Link
                  href={`/search/${video.id}`}
                  title="Search this video"
                  aria-label={`Search ${video.title}`}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <Search className="size-3.5" />
                </Link>
              )}
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={deleteVideo.isPending}
                aria-label={`Delete ${video.title}`}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
              </button>
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
