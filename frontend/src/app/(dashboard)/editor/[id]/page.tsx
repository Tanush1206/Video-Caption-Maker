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
import { cn } from "@/lib/utils";

/**
 * The editor is a workspace, not a page of prose, so it takes the screen.
 *
 * The rest of the app is capped at `max-w-7xl` (1280px), which is right for
 * reading and wrong here: it left ~320px dead on either side of a 1920 screen
 * while the video and the caption list fought over the middle. 1800px still
 * caps it on an ultrawide, where a truly full-bleed video would be silly.
 */
const SHELL = "mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6";

/**
 * A side column: its own scroll container, sticky, bounded to the viewport.
 *
 * The height is subtracted from `100vh` rather than being `h-full` because
 * these are grid items beside a video whose height follows its aspect ratio —
 * a portrait clip would stretch the row taller than the screen, and a sticky
 * element inside an over-tall parent has nothing to stick within.
 *
 * Each column scrolls itself and nothing scrolls inside anything else. That is
 * the whole point of the rearrangement: the caption list used to be the third
 * panel inside a scrolling rail, which is how you end up with two scrollbars
 * touching and no idea which one is yours.
 */
const SCROLL_COLUMN = "min-h-0 lg:h-[calc(100vh-8.5rem)] lg:overflow-y-auto lg:pr-0.5";

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
      <main className={SHELL}>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-7 w-64" />
        {/* Same tracks as the real layout, so the page does not jump sideways
            the moment the video loads. */}
        <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[300px_minmax(0,1fr)_360px]">
          <Skeleton className="aspect-video w-full rounded-xl 2xl:order-2" />
          <Skeleton className="h-[28rem] w-full rounded-xl 2xl:order-1" />
          <Skeleton className="hidden h-96 w-full rounded-xl lg:block 2xl:order-3" />
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
    <main className={SHELL}>
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

      {/*
        Three arrangements, and the middle one is why this uses explicit grid
        placement rather than source order plus `order-*`.

          < lg    everything stacked, the page scrolls
          lg-2xl  [ video ] [ rail ]     captions under the video, page scrolls
                  [ caps  ] [ rail ]
          >= 2xl  [ caps ] [ video ] [ rail ]

        Two columns until 1536px because three of them there would make the
        video *smaller* than it is today — 1024px of screen split three ways is
        worse than split two ways, and shrinking the frame you are positioning
        captions on to gain a column is a bad trade.

        The video keeps the flexible track at every size, so extra width goes to
        the frame rather than to the panels.
      */}
      <div
        className={cn(
          "grid items-start gap-4",
          "lg:grid-cols-[minmax(0,1fr)_360px]",
          "2xl:grid-cols-[300px_minmax(0,1fr)_360px]"
        )}
      >
        {/* Source order is video first: it is the most important thing here, and
            on a phone and to a screen reader that is the order that ships. */}
        <div className="space-y-3 lg:col-start-1 lg:row-start-1 2xl:col-start-2">
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

        {/*
          Captions. Under the video at two columns, a column of their own at
          three — and only sticky in the second case, because a list pinned to
          the viewport directly below the thing it belongs to just traps itself.

          The fixed height below 2xl is what lets the list scroll to follow the
          playhead instead of growing to the length of the transcript.
        */}
        <div
          className={cn(
            "flex h-[28rem] min-h-0 flex-col lg:col-start-1 lg:row-start-2",
            "2xl:col-start-1 2xl:row-start-1 2xl:sticky 2xl:top-6",
            "2xl:h-[calc(100vh-8.5rem)]"
          )}
        >
          <CaptionEditor video={video} playback={playback} />
        </div>

        {/* Style and export, sticky from the first two-column layout onwards. */}
        <div
          className={cn(
            SCROLL_COLUMN,
            "flex flex-col gap-4",
            "lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-6",
            "2xl:col-start-3 2xl:row-span-1"
          )}
        >
          <StylePanel videoId={videoId} />
          <ExportPanel videoId={videoId} hasCaptions={captions.length > 0} />
        </div>
      </div>
    </main>
  );
}
