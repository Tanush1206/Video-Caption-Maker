"use client";

import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Download,
  Feather,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import { Stepper } from "@/components/flow/stepper";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { useSystem, useUpdateSystemSettings } from "@/hooks/use-system";
import { useLanguageOptions, useRetranscribe } from "@/hooks/use-videos";
import { isOfferedSpeech, languageName, unsupportedSpeech } from "@/lib/languages";
import { stageLabel, useEta } from "@/lib/stages";
import { askToNotify, watchTranscription } from "@/lib/transcription-alerts";
import { cn } from "@/lib/utils";
import type { Video } from "@/types/video";

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      className="h-1 overflow-hidden rounded-full bg-surface-3"
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
    <div role="status" aria-live="polite" className="flex flex-col gap-8">
      {downloading && (
        <div className="group-inset px-4 py-3">
          <div className="flex items-start gap-3">
            <Download className="mt-[3px] size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium">Downloading the speech model. This happens once.</p>
              <p className="text-[13px] text-muted-foreground">
                It is saved on this computer; later videos start straight away.
              </p>
            </div>
            <span className="shrink-0 text-[15px] font-medium tabular-nums">{video.progress}%</span>
          </div>
          <div className="mt-3 pl-7">
            <ProgressBar percent={video.progress} label="Downloading the speech model" />
            {video.stage_detail && (
              <p className="mt-1.5 text-[13px] tabular-nums text-muted-foreground">{video.stage_detail}</p>
            )}
          </div>
        </div>
      )}

      <section aria-labelledby="pipeline-heading">
        <h2 className="text-xl font-semibold" id="pipeline-heading">
          Pipeline
        </h2>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {video.status === "pending"
            ? "Waiting: another video is being processed first."
            : "Running on this computer. You can leave this page; it carries on."}
        </p>

        {/* One grouped list; the stage that is running has the bar. */}
        <ol className="group-inset mt-4">
          {pipeline(video).map((step, index) => {
            const at = ORDER.indexOf(step.stage);
            const done = current > at;
            const active = current === at;
            return (
              <li
                key={step.stage}
                aria-current={active ? "step" : undefined}
                className="group-row flex-col items-stretch gap-0 py-3"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center" aria-hidden="true">
                    {done ? (
                      <Check className="size-4 text-muted-foreground" />
                    ) : active ? (
                      <Loader2 className="size-4 animate-spin text-primary" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[15px]", active && "font-medium", !done && !active && "text-muted-foreground")}>
                      <span className="sr-only">{index + 1}. </span>
                      {step.title}
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      {active && video.stage_detail ? video.stage_detail : step.detail}
                    </p>
                  </div>
                  <span className="shrink-0 text-right text-[13px] text-muted-foreground">
                    {done ? (
                      "Done"
                    ) : active ? (
                      <>
                        <span className="block text-[15px] font-medium tabular-nums text-foreground">
                          {video.progress}%
                        </span>
                        {eta && <span className="block">{eta}</span>}
                      </>
                    ) : (
                      "Queued"
                    )}
                  </span>
                </div>
                {active && (
                  <div className="mt-2.5 pl-[30px]">
                    <ProgressBar percent={video.progress} label={label} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <p className="mt-2 px-4 text-[13px] text-muted-foreground">
          You&apos;ll get a notification when it&apos;s done, if you allowed them.
        </p>
      </section>
    </div>
  );
}

function Failed({ video }: { video: Video }) {
  const retranscribe = useRetranscribe();
  const updateSettings = useUpdateSystemSettings();
  const { data: system } = useSystem();
  const model = system?.whisper?.model;
  // Offered whenever a smaller model exists to fall back to. The usual cause
  // of a failure that a retry won't fix is running out of memory, and the
  // small model needs the least. Two existing calls, no new backend: set the
  // install's speech model, then queue the video again.
  const canGoSmaller = Boolean(model) && model !== "small";
  const retrySmall = async () => {
    askToNotify();
    await updateSettings.mutateAsync({ whisper_model: "small" });
    retranscribe.mutate({ id: video.id }, { onSuccess: () => watchTranscription(video.id) });
  };
  const failedToRetry = updateSettings.error ?? retranscribe.error;

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
            {canGoSmaller && (
              <Button
                size="lg"
                variant="secondary"
                loading={updateSettings.isPending}
                disabled={retranscribe.isPending}
                onClick={() => void retrySmall().catch(() => undefined)}
                aria-describedby="retry-small-note"
              >
                <Feather />
                Retry with small model
              </Button>
            )}
            <Link href="/settings" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              <SlidersHorizontal />
              Open Settings
            </Link>
            {canGoSmaller && (
              <p id="retry-small-note" className="text-[12px] leading-snug text-muted-foreground">
                Small switches the speech model in Settings for every video, until you change it back.
              </p>
            )}
          </div>
        </div>
      </div>

      {failedToRetry && (
        <p role="alert" className="text-[13px] text-destructive">
          {failedToRetry.message}
        </p>
      )}

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

/**
 * What a finished video still has to say: that its speech is in a language
 * not offered (v1.0.11: tried anyway, started before the language step heard
 * it, or made before), a non-fatal notice from the job (e.g. a translation
 * fallback), or that no speech was found at all.
 */
function CompletedNotes({ video, captionCount }: { video: Video; captionCount: number }) {
  const { data: options } = useLanguageOptions();
  const heard = video.detected_language;
  const unsupported = heard !== null && options !== undefined && !isOfferedSpeech(heard, options) ? heard : null;
  if (unsupported === null && !video.notice && captionCount > 0) return null;
  return (
    <div className="mb-5 flex flex-col gap-2">
      {unsupported !== null && captionCount > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          {unsupportedSpeech(languageName(unsupported, options), true)}
        </p>
      )}
      {video.notice && captionCount > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          {video.notice}
        </p>
      )}
      {captionCount === 0 && (
        // The job says "No speech was found in this video." since v1.0.11,
        // after anything else it had to say; older videos say nothing.
        <p className="flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          {video.notice ?? "No speech was found in this video."} There is nothing to export. If
          that&apos;s wrong, try a larger speech model in Settings and process it again.
        </p>
      )}
    </div>
  );
}

/**
 * The top of a video's page: while it is on its way to captions, where it is
 * (step 2 of Upload → Language → Export) and what is running; once it is
 * there, only what the job had to say. Exporting is the editor bar's Export.
 */
export function VideoStatus({
  video,
  captionCount,
}: {
  video: Video;
  captionCount: number;
  onEdit?: () => void;
}) {
  if (video.status === "completed") return <CompletedNotes video={video} captionCount={captionCount} />;

  return (
    <section aria-label="Captioning progress" className="mx-auto mb-8 flex max-w-[880px] flex-col gap-8">
      <Stepper current={2} />
      {video.status === "failed" ? <Failed video={video} /> : <Processing video={video} />}
    </section>
  );
}
