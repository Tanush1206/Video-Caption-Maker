"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft, Search } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { CaptionEditor } from "@/components/captions/caption-editor";
import { ExportPanel } from "@/components/exports/export-panel";
import { PlayerControls } from "@/components/player/player-controls";
import { Timeline } from "@/components/player/timeline";
import { VideoPlayer } from "@/components/player/video-player";
import { StylePanel } from "@/components/styles/style-panel";
import { useCaptionStyle, useStyleOptions } from "@/hooks/use-caption-style";
import { useUpdateCaption, useVideoCaptions } from "@/hooks/use-captions";
import { usePlayback } from "@/hooks/use-playback";
import { usePlayerShortcuts } from "@/hooks/use-player-shortcuts";
import { useWaveform } from "@/hooks/use-stream";
import { useVideo } from "@/hooks/use-videos";
import { formatDuration } from "@/lib/format";

export default function EditorPage({ params }: { params: { id: string } }) {
  const videoId = Number(params.id);

  // Split in two so the workspace can call hooks unconditionally: a bad id has
  // to be rejected before any query is allowed to fire.
  if (Number.isNaN(videoId)) {
    return <p className="p-8 text-sm text-muted-foreground">Invalid video id.</p>;
  }

  return <EditorWorkspace videoId={videoId} />;
}

function EditorWorkspace({ videoId }: { videoId: number }) {
  const { data: video, isLoading, isError } = useVideo(videoId);

  // Shared with the caption list through React Query's cache rather than
  // props — both callers hit the same query key, so this is one request.
  const { data: captionData } = useVideoCaptions(videoId);
  const captions = useMemo(() => captionData?.items ?? [], [captionData]);

  const playback = usePlayback(captions, video?.duration_ms ?? null);
  usePlayerShortcuts(playback);

  const { data: waveform, isLoading: isLoadingWaveform } = useWaveform(videoId);
  const updateCaption = useUpdateCaption(videoId);

  // Both live here rather than inside the overlay: the panel edits the style
  // and the player draws it, so the shared parent owns the query.
  const { data: style } = useCaptionStyle(videoId);
  const { data: styleOptions } = useStyleOptions();
  const font = styleOptions?.fonts.find((f) => f.key === style?.font_key);

  const activeCaption =
    captions.find((caption) => caption.id === playback.activeCaptionId) ?? null;

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-7 w-64" />
        <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </main>
    );
  }

  if (isError || !video) {
    return (
      <main className="mx-auto max-w-md px-6 py-24 text-center">
        <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="size-5" />
        </span>
        <h1 className="text-lg font-semibold">Couldn&apos;t load this video</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been deleted, or the link may be wrong.
        </p>
        <Link href="/dashboard" className={`mt-6 ${buttonVariants()}`}>
          Back to your videos
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to your videos
      </Link>

      <div className="mb-5 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="min-w-0 truncate text-xl font-semibold sm:text-2xl">{video.title}</h1>

        {video.status === "completed" ? (
          <Link
            href={`/search/${video.id}`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            <Search />
            Search this video
          </Link>
        ) : (
          <Badge tone={video.status === "failed" ? "destructive" : "primary"} dot>
            {video.status}
          </Badge>
        )}

        <span className="ml-auto font-mono text-sm tabular-nums text-muted-foreground">
          {formatDuration(video.duration_ms)}
        </span>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-3">
          <VideoPlayer
            video={video}
            playback={playback}
            activeCaption={activeCaption}
            style={style}
            font={font}
          />
          <PlayerControls
            playback={playback}
            // Undecided until the waveform lands; empty peaks mean FFmpeg
            // found no audio stream, which is a fact about the file rather
            // than a volume problem.
            hasAudioTrack={waveform ? waveform.peaks.length > 0 : null}
          />
          <Timeline
            captions={captions}
            playback={playback}
            peaks={waveform?.peaks ?? []}
            isLoadingWaveform={isLoadingWaveform}
            activeCaptionId={playback.activeCaptionId}
            onCommit={(id, timing) => updateCaption.mutate({ id, ...timing })}
          />
        </div>

        {/* A bounded, independently scrolling column: the list has to be able
            to follow the playhead without moving the video off screen. */}
        <div className="flex h-[calc(100vh-13rem)] min-h-0 flex-col gap-4 overflow-y-auto lg:sticky lg:top-6">
          <StylePanel videoId={videoId} />
          <ExportPanel videoId={videoId} hasCaptions={captions.length > 0} />
          <div className="flex min-h-[24rem] flex-1 flex-col">
            <CaptionEditor video={video} playback={playback} />
          </div>
        </div>
      </div>
    </main>
  );
}
