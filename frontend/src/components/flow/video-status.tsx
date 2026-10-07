"use client";

import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Film,
  Info,
  Loader2,
  PencilLine,
  RefreshCw,
} from "lucide-react";

import { Stepper } from "@/components/flow/stepper";
import { Button } from "@/components/ui/button";
import { useCreateExport, useDownloadExport, useExports } from "@/hooks/use-exports";
import { useLanguageOptions, useRetranscribe } from "@/hooks/use-videos";
import { stageLabel, useEta } from "@/lib/stages";
import { askToNotify, watchTranscription } from "@/lib/transcription-alerts";
import { formatFileSize } from "@/lib/format";
import type { ExportFormat, VideoExport } from "@/types/export";
import type { Video } from "@/types/video";

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="bar-fill h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(2, percent)}%` }}
      />
    </div>
  );
}

function Processing({ video }: { video: Video }) {
  const label = stageLabel(video);
  const eta = useEta(video.status === "processing" ? `${video.id}:${video.stage}` : null, video.progress);

  return (
    <div role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
          {label}
        </p>
        {video.status === "processing" && (
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {video.progress}%
          </span>
        )}
      </div>
      <div className="mt-2.5">
        <ProgressBar percent={video.status === "processing" ? video.progress : 0} label={label} />
      </div>
      <p className="mt-2 text-body-sm text-muted-foreground">
        {[video.stage_detail, eta].filter(Boolean).join(" · ") ||
          (video.status === "pending"
            ? "Another video is being processed first."
            : "This runs on your computer and can take a while for long videos.")}
      </p>
      {video.stage === "downloading" && (
        <p className="mt-1 text-body-sm text-muted-foreground">
          Models are downloaded once. Later videos start straight away.
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        You can leave this page. Processing carries on, and you&apos;ll get a notification when
        it&apos;s done if you allowed them.
      </p>
    </div>
  );
}

function Failed({ video }: { video: Video }) {
  const retranscribe = useRetranscribe();
  return (
    <div role="alert">
      <p className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertCircle className="size-4" aria-hidden="true" />
        Couldn&apos;t make captions for this video
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {video.error_message ?? "Something went wrong while processing it."}
      </p>
      <Button
        className="mt-3"
        variant="secondary"
        size="sm"
        loading={retranscribe.isPending}
        onClick={() => {
          askToNotify();
          retranscribe.mutate(
            { id: video.id },
            { onSuccess: () => watchTranscription(video.id) }
          );
        }}
      >
        <RefreshCw />
        Try again
      </Button>
    </div>
  );
}

const latest = (items: VideoExport[], format: ExportFormat) =>
  items.find((item) => item.format === format) ?? null;

function ExportStep({
  video,
  captionCount,
  onEdit,
}: {
  video: Video;
  captionCount: number;
  onEdit: () => void;
}) {
  const { data: exports } = useExports(video.id);
  const create = useCreateExport(video.id);
  const download = useDownloadExport();
  const { data: languages } = useLanguageOptions();

  const items = exports?.items ?? [];
  const burn = latest(items, "mp4");
  const rendering = burn && (burn.status === "pending" || burn.status === "processing");
  const language =
    languages?.caption.find((option) => option.code === video.caption_language)?.label ??
    video.caption_language;

  async function subtitles(format: "srt" | "vtt") {
    const made = await create.mutateAsync({ format });
    download.mutate({ exportId: made.id, name: video.title });
  }

  return (
    <div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
        <span className="font-medium">Captions ready</span>
        <span className="text-muted-foreground">
          {captionCount} lines · {language === "Same as spoken" ? "in the spoken language" : language}
        </span>
      </p>

      {video.notice && (
        <p className="mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-body-sm text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {video.notice}
        </p>
      )}

      {captionCount === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No speech was found in this video, so there is nothing to export. If that&apos;s
          wrong, try a larger speech model in Settings and process it again.
        </p>
      ) : (
        <>
          {rendering && burn ? (
            <div className="mt-4" role="status" aria-live="polite">
              <div className="flex items-baseline justify-between text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                  {burn.status === "pending" ? "Waiting to render" : "Rendering video"}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">{burn.progress}%</span>
              </div>
              <div className="mt-2.5">
                <ProgressBar percent={burn.progress} label="Rendering video" />
              </div>
            </div>
          ) : burn?.status === "completed" ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                onClick={() => download.mutate({ exportId: burn.id, name: video.title })}
                loading={download.isPending}
              >
                <Download />
                Download video
              </Button>
              <span className="text-body-sm text-muted-foreground">
                MP4 with captions
                {burn.size_bytes ? ` · ${formatFileSize(burn.size_bytes)}` : ""}
                {burn.height ? ` · ${burn.height}p` : ""}
              </span>
            </div>
          ) : (
            <>
              {burn?.status === "failed" && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  The last render failed{burn.error_message ? `: ${burn.error_message}` : "."} Try
                  again.
                </p>
              )}
            </>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {!rendering && (
              <Button
                variant={burn?.status === "completed" ? "secondary" : "primary"}
                onClick={() => create.mutate({ format: "mp4" })}
                loading={create.isPending && create.variables?.format === "mp4"}
              >
                <Film />
                {burn?.status === "completed" ? "Render again" : "Export video with captions"}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => void subtitles("srt")}
              disabled={create.isPending}
            >
              <FileText />
              Subtitles (.srt)
            </Button>
            <Button
              variant="secondary"
              onClick={() => void subtitles("vtt")}
              disabled={create.isPending}
            >
              <FileText />
              Web subtitles (.vtt)
            </Button>
            <Button variant="ghost" onClick={onEdit}>
              <PencilLine />
              Edit captions or style
            </Button>
          </div>
          {create.isError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              Couldn&apos;t start the export. Try again.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The top of a video's page: where it is in Upload → Language → Export, and
 * the one action that moves it on.
 *
 * Editing and styling stay on the page below, a step you may take but never
 * have to: a finished video can be exported from here without touching them.
 */
export function VideoStatus({
  video,
  captionCount,
  onEdit,
}: {
  video: Video;
  captionCount: number;
  onEdit: () => void;
}) {
  const { data: exports } = useExports(video.id);
  const finished = exports?.items.some(
    (item) => item.format === "mp4" && item.status === "completed"
  );
  const step = video.status === "completed" ? (finished ? 4 : 3) : 2;

  return (
    <section
      aria-label="Captioning progress"
      className="glass-surface glass-rect mb-5 p-4 sm:p-5"
    >
      <Stepper current={step} className="mb-4" />
      {video.status === "failed" ? (
        <Failed video={video} />
      ) : video.status === "completed" ? (
        <ExportStep video={video} captionCount={captionCount} onEdit={onEdit} />
      ) : (
        <Processing video={video} />
      )}
    </section>
  );
}
