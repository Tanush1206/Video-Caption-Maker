"use client";

import Link from "next/link";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Film,
  Info,
  Loader2,
  PencilLine,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import { Stepper } from "@/components/flow/stepper";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { useCreateExport, useDownloadExport, useExports } from "@/hooks/use-exports";
import { useSystem } from "@/hooks/use-system";
import { useLanguageOptions, useRetranscribe } from "@/hooks/use-videos";
import { stageLabel, useEta } from "@/lib/stages";
import { askToNotify, watchTranscription } from "@/lib/transcription-alerts";
import { formatFileSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExportFormat, VideoExport } from "@/types/export";
import type { Video } from "@/types/video";

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-surface-3"
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(2, percent)}%` }}
      />
    </div>
  );
}

/**
 * The worker's stages, in the order it runs them (model, audio, speech,
 * translation, search index). Translation only happens
 * for a target other than English or the spoken language, so it is listed
 * only when one was asked for; whether it is then skipped (Whisper already
 * heard that language) shows as the list moving straight past it.
 */
function pipeline(video: Video): { stage: string; title: string; detail: string }[] {
  const steps = [
    { stage: "downloading", title: "Loading the speech model", detail: "Into memory, before anything is transcribed." },
    { stage: "extracting", title: "Preparing audio", detail: "The sound track is extracted from the video." },
    { stage: "transcribing", title: "Transcribing with faster-whisper", detail: "Speech to timed captions, on this computer." },
  ];
  if (video.caption_language !== "same" && video.caption_language !== "en") {
    steps.push({ stage: "translating", title: "Translating", detail: "Captions into the language you chose." });
  }
  steps.push({ stage: "embedding", title: "Building the search index", detail: "So this video can be searched by meaning." });
  return steps;
}

const ORDER = ["downloading", "extracting", "transcribing", "translating", "embedding"];

function Processing({ video }: { video: Video }) {
  const label = stageLabel(video);
  const eta = useEta(video.status === "processing" ? `${video.id}:${video.stage}` : null, video.progress);
  const current = video.status === "processing" && video.stage ? ORDER.indexOf(video.stage) : -1;
  // The worker reports "downloading" while it loads the model too; only a
  // real download says so in its detail ("Downloading … 1.2 of 2.9 GB").
  const downloading =
    video.stage === "downloading" && /^downloading/i.test(video.stage_detail ?? "");

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      {downloading && (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                <Download className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-base font-semibold">Downloading the speech model. This happens once.</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  It is saved on this computer; later videos start straight away.
                </p>
              </div>
            </div>
            <span className="text-right font-mono text-xs tabular-nums">
              {video.stage_detail && <span className="block">{video.stage_detail}</span>}
              <span className="text-success">{video.progress}%</span>
            </span>
          </div>
          <div className="mt-4">
            <ProgressBar percent={video.progress} label="Downloading the speech model" />
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-xl font-semibold tracking-tight">Pipeline</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {video.status === "pending"
            ? "Waiting: another video is being processed first."
            : "Running on this computer. You can leave this page; it carries on."}
        </p>

        <ol className="mt-5 flex flex-col gap-2">
          {pipeline(video).map((step, index) => {
            const at = ORDER.indexOf(step.stage);
            const done = current > at;
            const active = current === at;
            return (
              <li
                key={step.stage}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "rounded-lg p-4",
                  active ? "border border-border bg-surface-2" : "bg-surface-1",
                  !done && !active && "opacity-60"
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold",
                      done && "bg-success/15 text-success",
                      active && "bg-primary text-primary-foreground ring-4 ring-primary/20",
                      !done && !active && "border border-border text-muted-foreground"
                    )}
                    aria-hidden="true"
                  >
                    {done ? <Check className="size-4" /> : active ? index + 1 : <Clock className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {index + 1}. {step.title}
                      {active && (
                        <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
                          Active
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {active && video.stage_detail ? video.stage_detail : step.detail}
                    </p>
                  </div>
                  <span className="shrink-0 text-right font-mono text-xs uppercase tracking-wider">
                    {done ? (
                      <span className="text-success">Done</span>
                    ) : active ? (
                      <>
                        <span className="block text-base font-semibold tabular-nums text-primary">
                          {video.progress}%
                        </span>
                        {eta && <span className="normal-case tracking-normal text-muted-foreground">{eta}</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Queued</span>
                    )}
                  </span>
                </div>
                {active && (
                  <div className="mt-3">
                    <ProgressBar percent={video.progress} label={label} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <p className="mt-4 text-xs text-muted-foreground">
          You&apos;ll get a notification when it&apos;s done, if you allowed them.
        </p>
      </div>
    </div>
  );
}

function Failed({ video }: { video: Video }) {
  const retranscribe = useRetranscribe();
  const { data: system } = useSystem();
  const model = system?.whisper?.model;

  return (
    <div className="flex flex-col gap-4">
      <div role="alert" className="rounded-lg border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-destructive">
              <AlertCircle className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight">Processing stopped</h2>
              <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
                {video.error_message ?? "Something went wrong while processing it."}
              </p>
              <p className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[13px]">
                <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
                Your video is still on this computer. There is no need to upload it again.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2.5 sm:flex-row lg:w-64 lg:flex-col">
            <Button
              size="lg"
              loading={retranscribe.isPending}
              onClick={() => {
                askToNotify();
                retranscribe.mutate({ id: video.id }, { onSuccess: () => watchTranscription(video.id) });
              }}
            >
              <RefreshCw />
              Try again
            </Button>
            <Link href="/settings" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              <SlidersHorizontal />
              Open Settings
            </Link>
          </div>
        </div>
      </div>

      {model && (
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="label-caps">Speech model in use</p>
          <p className="mt-2 text-xl font-semibold">{model}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            If this stopped because the computer ran out of memory, a smaller model (Settings → Speech
            model) needs less.
          </p>
        </div>
      )}
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
    <section aria-label="Captioning progress" className="mb-5 flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card px-4 py-3 sm:px-6">
        <Stepper current={step} />
      </div>
      {video.status === "failed" ? (
        <Failed video={video} />
      ) : video.status === "completed" ? (
        <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <ExportStep video={video} captionCount={captionCount} onEdit={onEdit} />
        </div>
      ) : (
        <Processing video={video} />
      )}
    </section>
  );
}
