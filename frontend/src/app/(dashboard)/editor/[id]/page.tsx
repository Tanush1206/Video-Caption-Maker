"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { CaptionEditor } from "@/components/captions/caption-editor";
import { CaptionPeek } from "@/components/captions/caption-peek";
import { ExportPanel } from "@/components/exports/export-panel";
import { VideoStatus } from "@/components/flow/video-status";
import { PlayerControls } from "@/components/player/player-controls";
import { Timeline } from "@/components/player/timeline";
import { VideoPlayer } from "@/components/player/video-player";
import { Inspector, type InspectorTab } from "@/components/layout/editor-panel";
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
import { anchorOf, layoutCaption } from "@/lib/caption-layout";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Caption } from "@/types/caption";
import type { Alignment } from "@/types/style";

/** The loading and error states' frame. */
const SHELL = "mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-8";

/**
 * The workspace takes the screen below the two bars (52 + 52 px) from lg up:
 * the stage and the inspector side by side, the timeline across the bottom.
 */
const WORKSPACE_HEIGHT = "lg:h-[calc(100vh-104px)]";

/**
 * How much of the viewport's height is not the video, from lg up: the bars,
 * the stage's padding, the controls and hint, and the timeline. The video's
 * width follows from what is left, so a portrait clip fits too.
 */
const NOT_VIDEO_PX = 104 + 48 + 60 + 128;

export default function EditorPage() {
  // From the router: since Next 15 the `params` prop is a Promise.
  const videoId = Number(useParams<{ id: string }>().id);

  // Split in two so the workspace can call hooks unconditionally: a bad id has
  // to be rejected before any query is allowed to fire.
  if (Number.isNaN(videoId)) {
    return <p className="p-8 text-[15px] text-muted-foreground">This link doesn&apos;t point to a video.</p>;
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
   * The caption an alignment change or a placement keeps in view, laid out
   * as the overlay draws it: the one on screen, or in a gap the nearest one.
   */
  const shownLayout = () => {
    const frame = playback.intrinsic;
    if (!style || !frame) return null;
    let caption: Caption | null = activeCaption;
    if (!caption) {
      const now = playback.currentMs();
      const distance = (c: Caption) => (now < c.start_ms ? c.start_ms - now : now > c.end_ms ? now - c.end_ms : 0);
      caption = captions.reduce<Caption | null>((best, c) => (!best || distance(c) < distance(best) ? c : best), null);
    }
    return {
      frame,
      layout: layoutCaption(caption?.text ?? "", style, frame, {
        overrideScale: caption?.override_scale,
        bold: caption?.override_bold,
      }),
    };
  };
  /**
   * The `pos_x` that keeps that caption exactly where it is under
   * `alignment` (v1.2.0: alignment never moves it), or that centres it.
   */
  const anchorFor = (alignment: Alignment, centre = false) => {
    if (centre && alignment === "center") return 0.5;
    const shown = shownLayout();
    if (!shown) return centre ? 0.5 : (style?.pos_x ?? 0.5);
    const { frame, layout } = shown;
    const left = centre ? (frame.width - layout.width) / 2 : layout.x;
    return anchorOf(left, layout.width, alignment) / frame.width;
  };
  const shown = style && style.alignment !== "center" ? shownLayout() : null;
  const centred = shown
    ? Math.abs(shown.layout.x + shown.layout.width / 2 - shown.frame.width / 2) < 1
    : undefined;

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
  const [tool, setTool] = useState<InspectorTab>("captions");

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
        <AlertCircle className="mx-auto mb-4 size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">Couldn&apos;t load this video</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          It may have been deleted, or the link may be wrong.
        </p>
        <Link href="/dashboard" className={`mt-6 ${buttonVariants()}`}>
          Back to your videos
        </Link>
      </main>
    );
  }

  const aspect = playback.intrinsic ? playback.intrinsic.width / playback.intrinsic.height : 16 / 9;

  return (
    <>
      <EditorBar video={video} onExport={() => setExporting(true)} />

      {/* Where the video is on its way to captions, while it is not there
          yet; once it is, the notes that came with them. */}
      <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-8 [&:has(>*)]:pt-6">
        <VideoStatus
          video={video}
          captionCount={captions.length}
          onEdit={() =>
            document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        />
      </div>

      {/*
        From lg: the stage (the video, centred on a neutral ground, with its
        controls) and the inspector side by side, the timeline across the
        bottom. Below lg everything stacks, video first, and the inspector
        is a bottom sheet that fills the rest of the screen (one bar above it
        on a phone, two from md).
      */}
      <main
        id="workspace"
        className={cn(
          "flex scroll-mt-32 flex-col max-md:min-h-[calc(100dvh-52px)] md:max-lg:min-h-[calc(100dvh-104px)]",
          "lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[minmax(0,1fr)_auto]",
          WORKSPACE_HEIGHT
        )}
      >
        <section
          aria-label="Video"
          className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-3 bg-surface-2 px-4 py-6 sm:px-8 lg:col-start-1 lg:row-start-1"
        >
          <div
            className="w-full"
            style={{ maxWidth: `max(240px, min(100%, calc((100vh - ${NOT_VIDEO_PX}px) * ${aspect})))` }}
          >
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
            <PlayerControls
              playback={playback}
              // Undecided until the waveform lands; empty peaks mean FFmpeg
              // found no audio stream, which is a fact about the file rather
              // than a volume problem.
              hasAudioTrack={waveform ? waveform.peaks.length > 0 : null}
            />
          </div>
        </section>

        <Inspector
          tab={tool}
          onTab={setTool}
          peek={
            <CaptionPeek caption={activeCaption} onSave={(id, text) => updateCaption.mutate({ id, text })} />
          }
          className="lg:col-start-2 lg:row-span-1 lg:row-start-1 lg:border-l lg:border-border"
        >
          {{
            captions: <CaptionEditor video={video} playback={playback} />,
            style: (
              <StylePanel
                videoId={videoId}
                update={setStyle}
                isSaving={isSavingStyle}
                tab={tool === "captions" ? "typography" : tool}
                aspect={aspect}
                anchorFor={anchorFor}
                centred={centred}
              />
            ),
          }}
        </Inspector>

        <section
          aria-label="Timeline"
          className="min-w-0 border-t border-border px-4 py-3 sm:px-8 lg:col-span-2 lg:row-start-2"
        >
          <Timeline
            captions={captions}
            playback={playback}
            peaks={waveform?.peaks ?? []}
            isLoadingWaveform={isLoadingWaveform}
            activeCaptionId={playback.activeCaptionId}
            onCommit={(id, timing) => updateCaption.mutate({ id, ...timing })}
          />
        </section>
      </main>

      <Dialog
        open={exporting}
        onClose={() => setExporting(false)}
        title="Export"
        description={<ExportSubtitle video={video} />}
        bodyClassName="flex flex-col overflow-hidden"
        className="max-w-2xl"
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
          <span>
            {languages.spoken} → {languages.caption}
          </span>
        </>
      )}
    </>
  );
}

/**
 * The bar under the app header: which video this is, in which languages, and
 * the way out. Export is the screen's one primary action. Sticky with the
 * header and translucent like it.
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
    // At the top on a phone, where the app header steps aside in the editor.
    <div className="bar-translucent sticky top-0 z-30 border-b border-border md:top-header">
      <div className="mx-auto flex h-[52px] w-full max-w-[1800px] items-center gap-2 px-2 sm:px-6">
        <Link
          href="/dashboard"
          aria-label="Back to your videos"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out hover:bg-surface-2 hover:text-foreground sm:size-8"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="min-w-0 truncate text-[15px] font-semibold">{video.title}</h1>
          <span className="hidden shrink-0 text-sm text-muted-foreground md:inline">
            {[languages && `${languages.spoken} → ${languages.caption}`, formatDuration(video.duration_ms)]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {video.status !== "completed" && (
            <Badge
              tone={video.status === "failed" ? "destructive" : "primary"}
              dot
              className="hidden shrink-0 capitalize sm:inline-flex"
            >
              {video.status}
            </Badge>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {video.status === "completed" && (
            <Link
              href={`/search/${video.id}`}
              className={cn(buttonVariants({ variant: "plain", size: "sm" }), "hidden sm:inline-flex")}
            >
              Search this video
            </Link>
          )}
          {/* The primary action once there are captions; until then the
              page's own action (Try again) is. */}
          <Button size="sm" variant={video.status === "completed" ? "primary" : "secondary"} onClick={onExport}>
            Export
          </Button>
        </div>
      </div>
    </div>
  );
}
