"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Download,
  Film,
  Palette,
  Search,
  Subtitles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { CaptionEditor } from "@/components/captions/caption-editor";
import { ExportPanel } from "@/components/exports/export-panel";
import { VideoStatus } from "@/components/flow/video-status";
import { PlayerControls } from "@/components/player/player-controls";
import { Timeline } from "@/components/player/timeline";
import { VideoPlayer } from "@/components/player/video-player";
import { GradientField } from "@/components/layout/gradient-field";
import { EditorPanel, RailTabs } from "@/components/layout/editor-panel";
import { StylePanel } from "@/components/styles/style-panel";
import {
  useCaptionStyle,
  useStyleOptions,
  useUpdateCaptionStyle,
} from "@/hooks/use-caption-style";
import { captionKeys, useUpdateCaption, useVideoCaptions } from "@/hooks/use-captions";
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
 * How tall a side column may be: the viewport, less the header and this page's
 * own chrome.
 *
 * Subtracted from `100vh` rather than `h-full` because these are grid items
 * beside a video whose height follows its aspect ratio — a portrait clip would
 * stretch the row taller than the screen, and a sticky element inside an
 * over-tall parent has nothing to stick within.
 *
 * The panel scrolls its *body* under a pinned head, so the column itself never
 * scrolls. That is what keeps each region labelled while you read it.
 */
const COLUMN_HEIGHT = "lg:h-[calc(100vh-9.5rem)]";

/**
 * The same height, but earned at 2xl instead of lg — the captions column only
 * becomes a column at the widest layout.
 *
 * Written out rather than derived from COLUMN_HEIGHT, because Tailwind reads
 * class names out of the source as literal text: a name assembled at runtime
 * is a name the compiler never sees, so the rule is never generated and the
 * class silently does nothing.
 */
const COLUMN_HEIGHT_2XL = "2xl:h-[calc(100vh-9.5rem)]";

/**
 * The glass goes on each panel, and stays put while its contents scroll.
 *
 * `backdrop-filter` is cheap while what it samples holds still and expensive
 * when the blurred element moves across its backdrop — the browser re-blurs
 * every frame. These panels are sticky and scroll internally, so the blur is
 * computed once and reused.
 */
const RAIL_TABS = [
  { id: "style", label: "Style", icon: Palette },
  { id: "export", label: "Export", icon: Download },
] as const;

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
  // One updater for the whole screen. The style panel and the drag handle on
  // the video both write through it — see StylePanel for why two instances
  // race each other.
  const { update: setStyle, isSaving: isSavingStyle } = useUpdateCaptionStyle(videoId);
  const { data: styleOptions } = useStyleOptions();
  const font = styleOptions?.fonts.find((f) => f.key === style?.font_key);

  const activeCaption =
    captions.find((caption) => caption.id === playback.activeCaptionId) ?? null;

  /**
   * Pull the captions again the moment a transcription finishes.
   *
   * Re-transcribing invalidates them, but that happens when the job is
   * *queued* — minutes before there is anything new to fetch, so the refetch
   * returns the very captions the worker is about to delete. Nothing asked
   * again afterwards, which is why changing the language appeared to leave the
   * captions in the old one.
   *
   * Gated on having seen the video busy first, so simply opening a finished
   * video does not refetch a list that just arrived.
   */
  const queryClient = useQueryClient();
  const status = video?.status;
  const wasTranscribing = useRef(false);

  const [railTool, setRailTool] = useState<string>("style");

  useEffect(() => {
    if (status === "pending" || status === "processing") {
      wasTranscribing.current = true;
      return;
    }
    if (!wasTranscribing.current) return;
    wasTranscribing.current = false;
    void queryClient.invalidateQueries({ queryKey: captionKeys.forVideo(videoId) });
  }, [status, queryClient, videoId]);

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
    <main className={cn(SHELL, "relative")}>
      {/* Quieter again than the dashboard, and deliberately so. This screen is
          where caption colour and contrast get judged against the frame, and a
          strong wash around the video would bias that judgement — the tool
          would be lying to you about what the export looks like. Ambience at
          the edges, neutral where the video is. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
        <GradientField className="opacity-65" />
        <div className="absolute inset-0 bg-background/[0.82] backdrop-blur-[2px]" />
      </div>

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

      {/* Step 3 of the flow, or where the video is on the way to it. */}
      <VideoStatus
        video={video}
        captionCount={captions.length}
        onEdit={() =>
          document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
      />

      <h2 id="workspace" className="mb-3 flex scroll-mt-20 items-baseline gap-2 text-h2">
        Edit captions and style
        <span className="text-body-sm font-normal text-muted-foreground">optional</span>
      </h2>

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
          // minmax(0,1fr) at the base too: an implicit track sizes to its
          // widest child's max-content, and the player's control row is wider
          // than a phone, so the whole page scrolled sideways.
          "grid grid-cols-[minmax(0,1fr)] items-start gap-4",
          "lg:grid-cols-[minmax(0,1fr)_380px]",
          "2xl:grid-cols-[340px_minmax(0,1fr)_380px]"
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
            // The same updater the panel uses, so a drag and a click on the
            // 3x3 grid are one code path — and the drag inherits its debounce,
            // which matters when a single gesture produces a value per frame.
            onPlace={setStyle}
          />

          {/* The one instruction the video cannot give you by looking at it.
              Dragging the caption is the editor's least discoverable feature
              and its most useful one — it was previously documented in a
              `title` attribute, which is to say nowhere. */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-[11px] text-muted-foreground">
            <Film className="size-3" />
            <span>Drag the caption to place it anywhere on the frame.</span>
            <span aria-hidden="true">·</span>
            <span>Click the video to play or pause.</span>
          </p>

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
        <EditorPanel
          icon={Subtitles}
          title="Captions"
          hint="Click a line to jump there. Edits save as you type."
          className={cn(
            "h-[30rem] lg:col-start-1 lg:row-start-2",
            "2xl:col-start-1 2xl:row-start-1 2xl:sticky 2xl:top-6",
            COLUMN_HEIGHT_2XL
          )}
        >
          <CaptionEditor video={video} playback={playback} />
        </EditorPanel>

        {/* Style and export, as two tools rather than one long scroll. */}
        <EditorPanel
          icon={railTool === "style" ? Palette : Download}
          title={railTool === "style" ? "Caption style" : "Export"}
          hint={
            railTool === "style"
              ? "Font, size and colour. Every change previews on the video."
              : "Burn the captions in, or take the subtitles as a file."
          }
          className={cn(
            COLUMN_HEIGHT,
            "lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-6",
            "2xl:col-start-3 2xl:row-span-1"
          )}
          bodyClassName="space-y-3"
        >
          <RailTabs tabs={[...RAIL_TABS]} value={railTool} onChange={setRailTool} />

          {/* Both stay mounted. The style panel holds a font list that has
              scrolled somewhere and a colour picker mid-edit, and unmounting
              a tab to save nothing throws that away every time someone checks
              the export options. */}
          <div hidden={railTool !== "style"}>
            <StylePanel
              videoId={videoId}
              update={setStyle}
              isSaving={isSavingStyle}
              aspect={
                playback.intrinsic
                  ? playback.intrinsic.width / playback.intrinsic.height
                  : undefined
              }
            />
          </div>
          <div hidden={railTool !== "export"}>
            <ExportPanel
              videoId={videoId}
              hasCaptions={captions.length > 0}
              defaultName={video.title}
            />
          </div>
        </EditorPanel>
      </div>
    </main>
  );
}
