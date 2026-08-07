"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";

import { CaptionEditor } from "@/components/captions/caption-editor";
import { PlayerControls } from "@/components/player/player-controls";
import { Timeline } from "@/components/player/timeline";
import { VideoPlayer } from "@/components/player/video-player";
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

  const activeCaption =
    captions.find((caption) => caption.id === playback.activeCaptionId) ?? null;

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      </main>
    );
  }

  if (isError || !video) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-500">
          Couldn&apos;t load this video. It may have been deleted.
        </p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-primary hover:underline">
          Back to your videos
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <Link
        href="/dashboard"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to your videos
      </Link>

      <h1 className="text-xl font-semibold">{video.title}</h1>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        {formatDuration(video.duration_ms)}
        {video.status !== "completed" && ` · ${video.status}`}
      </p>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-3">
          <VideoPlayer video={video} playback={playback} activeCaption={activeCaption} />
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
        <div className="flex h-[calc(100vh-13rem)] flex-col lg:sticky lg:top-6">
          <CaptionEditor video={video} playback={playback} />
        </div>
      </div>
    </main>
  );
}
