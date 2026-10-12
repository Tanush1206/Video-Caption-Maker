"use client";

import {
  AlertTriangle,
  Captions,
  Check,
  Clapperboard,
  Download,
  FileCode,
  FileText,
  Info,
  Loader2,
  PencilLine,
  Trash2,
  Video,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCreateExport,
  useDeleteExport,
  useDownloadExport,
  useExportOptions,
  useExports,
} from "@/hooks/use-exports";
import { useDownloadOriginal } from "@/hooks/use-stream";
import { formatFileSize, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExportFormat, VideoExport } from "@/types/export";
import { useState } from "react";

/**
 * Everything you can get out of a video, in one list.
 *
 * `original` is not an ExportFormat — nothing is rendered and no row is stored,
 * it is the uploaded file handed straight back. It belongs here anyway: it was
 * previously a hover-only icon floating on the video, which made "download this
 * video" two unrelated controls in two places, and hid the only thing available
 * at all before captions finish.
 */
type Choice = ExportFormat | "original";

const FORMATS: {
  key: Choice;
  label: string;
  ext: string;
  hint: string;
  icon: typeof FileText;
}[] = [
  { key: "mp4", label: "Burned-in video", ext: ".mp4", hint: "The captions drawn into the video frames, in the style you set.", icon: Clapperboard },
  { key: "srt", label: "Subtitle file", ext: ".srt", hint: "Standard SubRip timed subtitles, for video editors and players.", icon: FileText },
  { key: "vtt", label: "Web subtitles", ext: ".vtt", hint: "WebVTT, for the <track> element of web players.", icon: Captions },
  { key: "original", label: "Original video", ext: "", hint: "The file you uploaded, untouched, with no captions.", icon: Video },
  { key: "json", label: "Transcript data", ext: ".json", hint: "Every caption with its timings, for scripts and other tools.", icon: FileCode },
];

const ICONS: Record<string, typeof FileText> = { mp4: Clapperboard, srt: FileText, vtt: Captions, json: FileCode };

function StatusLine({ item }: { item: VideoExport }) {
  if (item.status === "failed") {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive">
        <AlertTriangle className="h-3 w-3" />
        {item.error_message ?? "Render failed"}
      </span>
    );
  }

  if (item.status === "pending" || item.status === "processing") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {item.status === "pending" ? "Queued" : `Rendering ${item.progress}%`}
      </span>
    );
  }

  return (
    <span className="text-xs text-muted-foreground">
      {item.height ? `${item.height}p · ` : ""}
      {item.size_bytes ? formatFileSize(item.size_bytes) : "—"} ·{" "}
      {formatRelativeTime(item.created_at)}
    </span>
  );
}

export function ExportPanel({
  videoId,
  hasCaptions,
  defaultName,
  onCancel,
}: {
  videoId: number;
  hasCaptions: boolean;
  /** The video's title, as the starting point for the saved filename. */
  defaultName: string;
  /** Closes the dialog this sits in. */
  onCancel?: () => void;
}) {
  const { data, isLoading } = useExports(videoId);
  const { data: options } = useExportOptions(videoId);
  const createExport = useCreateExport(videoId);
  const deleteExport = useDeleteExport(videoId);
  const download = useDownloadExport();
  const downloadOriginal = useDownloadOriginal(videoId);

  /**
   * The height to burn at. Null means "whatever the server recommends", which
   * is not the source's own size — see `recommended_height`. A 144p source
   * renders its captions at 6px, so defaulting to the source would make the
   * obvious button produce a file whose captions cannot be read.
   */
  const [height, setHeight] = useState<number | null>(null);

  /**
   * What the saved file will be called.
   *
   * Empty means "use the server's name", which is the source filename plus a
   * "-captions" suffix on a burn. Held here rather than saved anywhere: this
   * names a *download*, not the video, and someone exporting one clip under a
   * different name has not asked to rename the thing in their library.
   *
   * The extension is never shown or typed. It is decided by the format button
   * that gets pressed, so offering it here would only let someone type one
   * that contradicts the button.
   */
  const [name, setName] = useState("");
  /** The target picked in the cards; Export runs it. */
  const [choice, setChoice] = useState<Choice>(hasCaptions ? "mp4" : "original");
  const savedAs = name.trim();
  const resolutions = options?.resolutions ?? [];
  const recommended = options?.recommended_height ?? null;
  const chosen = height ?? recommended ?? options?.source_height ?? null;
  const chosenOption = resolutions.find((r) => r.height === chosen);

  const items = data?.items ?? [];
  // One burn at a time is enough; a second would queue behind it and produce a
  // duplicate file nobody asked for.
  const rendering = items.some(
    (item) => item.format === "mp4" && (item.status === "pending" || item.status === "processing")
  );

  const failed = createExport.error ?? downloadOriginal.error;

  const needsCaptions = choice !== "original";
  const canRun = !(needsCaptions && !hasCaptions) && !(choice === "mp4" && rendering);
  const busy = createExport.isPending || downloadOriginal.isPending;
  const burn = items.find((item) => item.format === "mp4" && item.status === "processing");

  function run() {
    if (choice === "original") downloadOriginal.mutate(savedAs || undefined);
    else
      createExport.mutate({
        format: choice,
        // Only a burn has a frame size; the server drops it for the
        // sidecars anyway, but not sending it is clearer.
        height: choice === "mp4" && chosen ? chosen : undefined,
      });
  }

  return (
    // Its own scroll area above a footer that stays put; the dialog hands
    // over its body (bodyClassName) for this.
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5 sm:px-7">
      {/* Says what is unavailable, not that nothing is. */}
      {!hasCaptions && (
        <p className="rounded-md border border-border bg-surface-1 px-3 py-2 text-[13px] text-muted-foreground">
          Captions aren&apos;t ready yet. You can still download the original.
        </p>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="label-caps" id="export-target">
            Export target
          </p>
          <span className="font-mono text-xs text-muted-foreground">{FORMATS.length} formats</span>
        </div>
        <div role="radiogroup" aria-labelledby="export-target" className="grid gap-3 sm:grid-cols-3">
          {FORMATS.map(({ key, label, ext, hint, icon: Icon }) => {
            const selected = choice === key;
            const unavailable = key !== "original" && !hasCaptions;
            return (
              <label
                key={key}
                className={cn(
                  "relative flex cursor-pointer flex-col gap-2 rounded-lg border p-4 transition-colors",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
                  selected ? "border-primary/60 bg-primary/10" : "border-border bg-surface-1 hover:bg-surface-2",
                  unavailable && "pointer-events-none opacity-40"
                )}
              >
                <input
                  type="radio"
                  name="export-format"
                  value={key}
                  checked={selected}
                  disabled={unavailable}
                  onChange={() => setChoice(key)}
                  className="sr-only"
                />
                <span className="flex items-start justify-between">
                  <span className="flex size-8 items-center justify-center rounded-md border border-border bg-card text-primary">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full",
                      selected ? "bg-primary text-primary-foreground" : "border border-border bg-card"
                    )}
                  >
                    {selected && <Check className="size-3" />}
                  </span>
                </span>
                <span className="flex flex-wrap items-baseline gap-1.5 text-[15px] font-semibold">
                  {label}
                  {ext && (
                    <span className="rounded-sm bg-surface-2 px-1 font-mono text-[11px] font-normal text-muted-foreground">
                      {ext}
                    </span>
                  )}
                </span>
                <span className="text-[13px] leading-snug text-muted-foreground">{hint}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface-1 p-4 sm:p-5">
        <p className="label-caps">Output</p>

        {/* Applies to whichever format is exported, and to the downloads in
            the list below. The extension is never typed: the format decides
            it. */}
        <label htmlFor="export-name" className="mt-4 block text-[13px] font-medium">
          File name
        </label>
        <div className="relative mt-1.5">
          <PencilLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            id="export-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={defaultName}
            spellCheck={false}
            // maxLength matches the server's cap, so the field cannot accept
            // something the download will then silently shorten.
            maxLength={120}
            className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 font-mono text-[13px] focus:border-ring focus:outline-none"
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {savedAs
            ? `Downloads as "${savedAs}", with the extension for the format.`
            : "Leave blank to use the video's own filename."}
        </p>

        {/* Only for a burn, and only once the server has said what it can do. */}
        {choice === "mp4" && resolutions.length > 0 && (
          <div className="mt-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-medium" id="export-resolution">
                Resolution
              </p>
              {options?.source_height && (
                <span className="font-mono text-xs text-muted-foreground">Source: {options.source_height}p</span>
              )}
            </div>
            <div
              role="radiogroup"
              aria-labelledby="export-resolution"
              className="mt-1.5 inline-flex flex-wrap gap-1 rounded-lg border border-border bg-background p-1"
            >
              {resolutions.map((resolution) => (
                <button
                  key={resolution.height}
                  type="button"
                  role="radio"
                  aria-checked={chosen === resolution.height}
                  onClick={() => setHeight(resolution.height)}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-[13px] tabular-nums transition-colors",
                    chosen === resolution.height
                      ? "bg-surface-3 font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {resolution.label}
                  {resolution.height === recommended && (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">recommended</span>
                  )}
                </button>
              ))}
            </div>
            {/* Said plainly, because "1080p" on a 144p source promises
                something it cannot deliver. */}
            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
              {chosenOption?.upscaled
                ? `Upscaled from ${options?.source_height}p: captions are drawn sharp at ${chosenOption.label}, the picture gains no detail. At ${options?.source_height}p they would render too small to read.`
                : chosenOption?.native
                  ? "The source's own size: nothing is resampled."
                  : `Rendered at ${chosenOption?.label ?? ""}.`}
              {options?.hardware_encoder ? " GPU encoding." : ""}
            </p>
          </div>
        )}
      </div>

      {burn && (
        <div className="rounded-lg border border-border bg-surface-2 p-4" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-[15px]">
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-success" aria-hidden="true" />
              Rendering the video with captions
            </span>
            <span className="font-mono text-[13px] font-semibold tabular-nums text-success">{burn.progress}%</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${burn.progress}%` }}
            />
          </div>
        </div>
      )}

      {failed && (
        <p role="alert" className="text-[13px] text-destructive">
          {(failed as Error).message}
        </p>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="label-caps">Previous exports for this video</p>
          <span className="font-mono text-xs text-muted-foreground">
            {items.length} file{items.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {isLoading && <Skeleton className="h-14" />}

          {!isLoading && items.length === 0 && (
            <p className="rounded-lg border border-dashed border-border py-4 text-center text-[13px] text-muted-foreground">
              No exports yet.
            </p>
          )}

          {items.map((item) => {
            const Icon = ICONS[item.format] ?? FileText;
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface-1 px-3 py-2.5"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[13px] font-medium uppercase">
                    {item.format}
                    {item.height ? <span className="normal-case"> · {item.height}p</span> : null}
                  </p>
                  <StatusLine item={item} />
                </div>
                <button
                  type="button"
                  onClick={() => download.mutate({ exportId: item.id, name: savedAs || undefined })}
                  disabled={item.status !== "completed" || download.isPending}
                  aria-label={`Download ${item.format}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 text-[13px] transition-colors hover:bg-surface-3 disabled:opacity-40"
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => deleteExport.mutate(item.id)}
                  title="Delete this export"
                  aria-label={`Delete ${item.format} export`}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      </div>

      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-5 py-4 sm:px-7">
        <p className="hidden min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground sm:flex">
          <Info className="size-4 shrink-0" aria-hidden="true" />
          {rendering
            ? "Burning captions in re-encodes the video. Download appears when it finishes."
            : choice === "original"
              ? "Downloads straight away."
              : "Appears in the list above; download it from there."}
        </p>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button onClick={run} disabled={!canRun || busy} loading={busy}>
          {choice === "mp4" && rendering ? "Exporting…" : `Export ${FORMATS.find((f) => f.key === choice)?.ext || "original"}`}
        </Button>
      </div>
    </section>
  );
}
