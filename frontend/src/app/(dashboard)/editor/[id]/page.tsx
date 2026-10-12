"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Clapperboard,
  Film,
  Palette,
  Search,
  Share,
  SlidersHorizontal,
  Subtitles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { CaptionEditor } from "@/components/captions/caption-editor";
import { ExportPanel } from "@/components/exports/export-panel";
import { VideoStatus } from "@/components/flow/video-status";
import { PlayerControls } from "@/components/player/player-controls";
import { Timeline } from "@/components/player/timeline";
import { VideoPlayer } from "@/components/player/video-player";
import { EditorPanel } from "@/components/layout/editor-panel";
import { useLanguagePair } from "@/components/videos/video-card";
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
const SHELL = "mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6"; // = WIDE_CONTAINER + padding

/**
 * How tall the transcript column may be: the viewport, less the app header,
 * the editor bar and a margin. Subtracted from 100vh rather than h-full
 * because it is a grid item beside a column whose height follows the video
 * and the style studio; a sticky element inside an over-tall parent has
 * nothing to stick within. The panel scrolls its body under a pinned head.
 */
const COLUMN_HEIGHT = "lg:h-[calc(100vh-9rem)]";

export default function EditorPage({ params }: { params: { id: string } }) {
  const videoId = Number(params.id);

  // Split in two so the workspace can call hooks unconditionally: a bad id has
  // to be rejected before any query is allowed to fire.
  if (Number.isNaN(videoId)) {
    return <p className="p-8 text-sm text-muted-foreground">This link doesn&apos;t point to a video.</p>;
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

  const [exporting, setExporting] = useState(false);

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
    <>
      <EditorBar
        video={video}
        onExport={() => setExporting(true)}
      />

      <main className={cn(SHELL, "pb-24 md:pb-6")}>
        {/* Where the video is on its way to captions, while it is not there
            yet; once it is, the notes that came with them. */}
        <VideoStatus
          video={video}
          captionCount={captions.length}
          onEdit={() =>
            document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        />

        {/*
          Two columns from lg: the frame, its controls, the timeline and the
          style studio on the left; the transcript on the right, pinned to the
          viewport and scrolling inside itself to follow the playhead. Below
          lg everything stacks, video first: it is the most important thing
          here, and on a phone and to a screen reader that is the order that
          ships.
        */}
        <div
          id="workspace"
          className={cn(
            // minmax(0,1fr) at the base too: an implicit track sizes to its
            // widest child's max-content, and the player's control row is wider
            // than a phone, so the whole page scrolled sideways.
            "grid scroll-mt-32 grid-cols-[minmax(0,1fr)] items-start gap-6",
            "lg:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_460px]"
          )}
        >
          <div className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-1">
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <VideoPlayer
                video={video}
                playback={playback}
                activeCaption={activeCaption}
                style={style}
                font={font}
                // The same updater the panel uses, so a drag and a click on the
                // 3x3 grid are one code path — and the drag inherits its
                // debounce, which matters when a single gesture produces a value
                // per frame.
                onPlace={setStyle}
              />
            </div>

            {/* The one instruction the video cannot give you by looking at it.
                Dragging the caption is the editor's least discoverable feature
                and its most useful one. */}
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

          {/* The fixed height below lg is what lets the list scroll to follow
              the playhead instead of growing to the length of the transcript. */}
          <EditorPanel
            icon={Subtitles}
            title="Transcript segments"
            hint="Click a line to jump there. Edits save as you type."
            action={
              <span className="rounded-md border border-border bg-surface-1 px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                {captions.length} segment{captions.length === 1 ? "" : "s"}
              </span>
            }
            className={cn("h-[34rem] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-[7.5rem]", COLUMN_HEIGHT)}
          >
            <CaptionEditor video={video} playback={playback} />
          </EditorPanel>

          {/* Its own grid item, so on a phone it comes after the transcript. */}
          <div id="caption-style" className="min-w-0 scroll-mt-32 lg:col-start-1 lg:row-start-2">
            <EditorPanel
              icon={Palette}
              title="Caption style studio"
              hint="Font, size, colour and position. Every change previews on the video."
              bodyClassName="p-4"
            >
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
            </EditorPanel>
          </div>
        </div>
      </main>

      {/* Phones: the two things the desktop bar and studio hold, at thumb
          height. Replaces the section tab bar on this screen. */}
      <div className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 gap-3 border-t border-border bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-lg md:hidden">
        <Button
          variant="secondary"
          size="lg"
          onClick={() =>
            document.getElementById("caption-style")?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        >
          <SlidersHorizontal />
          Caption style
        </Button>
        <Button size="lg" onClick={() => setExporting(true)}>
          <Share />
          Export
        </Button>
      </div>

      <Dialog
        open={exporting}
        onClose={() => setExporting(false)}
        title="Export video & captions"
        icon={<Share className="size-5" />}
        description={<ExportSubtitle video={video} />}
        bodyClassName="flex flex-col overflow-hidden"
      >
        <ExportPanel
          videoId={videoId}
          hasCaptions={captions.length > 0}
          defaultName={video.title}
          onCancel={() => setExporting(false)}
        />
      </Dialog>
    </>
  );
}

/** "english60.mp4 · English → Hindi", under the export dialog's title. */
function ExportSubtitle({ video }: { video: NonNullable<ReturnType<typeof useVideo>["data"]> }) {
  const languages = useLanguagePair(video);
  return (
    <>
      {video.original_filename}
      {languages && (
        <>
          {" · "}
          <span className="font-medium text-primary">
            {languages.spoken} → {languages.caption}
          </span>
        </>
      )}
    </>
  );
}

/**
 * The bar under the app header: which video this is, how long, in which
 * languages, and the way out (Export). Sticky with the header, so Export is
 * always one click away.
 */
function EditorBar({
  video,
  onExport,
}: {
  video: NonNullable<ReturnType<typeof useVideo>["data"]>;
  onExport: () => void;
}) {
  const languages = useLanguagePair(video);
  return (
    <div className="sticky top-header z-30 border-b border-border bg-background/90 backdrop-blur-lg">
      <div className="mx-auto flex h-14 w-full max-w-[1800px] items-center gap-3 px-4 sm:px-6">
        <Link
          href="/dashboard"
          aria-label="Back to your videos"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <Clapperboard className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
        <h1 className="min-w-0 truncate text-[15px] font-semibold">{video.title}</h1>
        <span className="hidden shrink-0 font-mono text-[13px] tabular-nums text-muted-foreground sm:inline">
          {formatDuration(video.duration_ms)}
        </span>
        {languages && (
          <span className="hidden shrink-0 text-[13px] font-medium text-primary md:inline">
            {languages.spoken} → {languages.caption}
          </span>
        )}
        {video.status !== "completed" && (
          <Badge tone={video.status === "failed" ? "destructive" : "primary"} dot className="shrink-0">
            {video.status}
          </Badge>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {video.status === "completed" && (
            <Link
              href={`/search/${video.id}`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}
            >
              <Search />
              Search this video
            </Link>
          )}
          <Button size="sm" onClick={onExport}>
            <Share />
            Export
          </Button>
        </div>
      </div>
    </div>
  );
}
