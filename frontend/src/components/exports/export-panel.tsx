"use client";

import {
  AlertTriangle,
  Captions,
  Check,
  Clapperboard,
  Download,
  FileCode,
  FileText,
  History,
  Loader2,
  Trash2,
  Video,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCreateExport,
  useDeleteExport,
  useDownloadExport,
  useExportOptions,
  useExports,
} from "@/hooks/use-exports";
import { useDownloadOriginal } from "@/hooks/use-stream";
import { useLanguageOptions } from "@/hooks/use-videos";
import { formatFileSize, formatRelativeTime } from "@/lib/format";
import { languageName } from "@/lib/languages";
import { useEta } from "@/lib/stages";
import { cn } from "@/lib/utils";
import type { ExportFormat, VideoExport } from "@/types/export";
import type { LanguageOptions } from "@/types/video";
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

/**
 * Which captions an export holds, by language, and whether they have since
 * been replaced. An export is a file made at one moment: after a Redo into
 * another language the old SRT is still in the list, and unlabelled it was
 * downloaded as the new one.
 */
function LanguageLine({ item, options }: { item: VideoExport; options: LanguageOptions | undefined }) {
  if (!item.caption_language) return null;
  const name = item.caption_language === "same" ? "Spoken language" : languageName(item.caption_language, options);
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
      <span>{name}</span>
      {item.current === false && (
        // Said in words, in the warning's text tone; no pill.
        <span className="inline-flex items-center gap-1 text-warning">
          <History className="size-3.5" aria-hidden="true" />
          From earlier captions
        </span>
      )}
    </span>
  );
}

function StatusLine({ item }: { item: VideoExport }) {
  if (item.status === "failed") {
    return (
      <span className="flex items-center gap-1 text-[13px] text-destructive">
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        {item.error_message ?? "Render failed"}
      </span>
    );
  }

  if (item.status === "pending" || item.status === "processing") {
    return (
      <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        {item.status === "pending" ? "Queued" : `Rendering ${item.progress}%`}
      </span>
    );
  }

  return (
    <span className="text-[13px] text-muted-foreground">
      {item.height ? `${item.height}p · ` : ""}
      {item.size_bytes ? formatFileSize(item.size_bytes) : "—"} ·{" "}
      {formatRelativeTime(item.created_at)}
    </span>
  );
}

/** A group inside the dialog: the grouped tone, a step up in dark (the dialog is already the card). */
const GROUP = "group-inset dark:bg-surface-3";

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
  const { data: languages } = useLanguageOptions();

  /**
   * The height to burn at. Null means "whatever the server recommends": the
   * source's own size, since nothing larger is offered (v1.1.0).
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
  const eta = useEta(burn ? `export:${burn.id}` : null, burn?.progress ?? 0);

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
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-6 pb-6 pt-4 [&>*]:shrink-0">
        {/* Says what is unavailable, not that nothing is. */}
        {!hasCaptions && (
          <Notice className="dark:bg-surface-3" title="Captions aren't ready yet. You can still download the original." />
        )}

        <div>
          <p className="label-caps mb-1.5 px-4" id="export-target">
            Export target
          </p>
          {/* A grouped list with a check on the chosen row. */}
          <div role="radiogroup" aria-labelledby="export-target" className={GROUP}>
            {FORMATS.map(({ key, label, ext, hint, icon: Icon }) => {
              const selected = choice === key;
              const unavailable = key !== "original" && !hasCaptions;
              return (
                <label
                  key={key}
                  className={cn(
                    "group-row cursor-pointer justify-start gap-3 transition-colors duration-200 ease-out hover:bg-surface-3/50",
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring",
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
                  <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px]">
                      {label}
                      {ext && <span className="text-muted-foreground"> {ext}</span>}
                    </span>
                    <span className="block text-[13px] text-muted-foreground">{hint}</span>
                  </span>
                  <Check
                    aria-hidden="true"
                    className={cn("size-5 shrink-0 text-primary", !selected && "invisible")}
                  />
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <p className="label-caps mb-1.5 px-4">Output</p>
          <div className={GROUP}>
            {/* Applies to whichever format is exported, and to the downloads
                in the list below. The extension is never typed: the format
                decides it. */}
            <div className="group-row flex-wrap gap-y-2">
              <label htmlFor="export-name" className="text-[15px]">
                File name
              </label>
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
                className={cn(inputClasses, "w-full sm:w-72")}
              />
            </div>

            {/* Only for a burn, and only once the server has said what it can do. */}
            {choice === "mp4" && resolutions.length > 0 && (
              <div className="group-row flex-wrap gap-y-2">
                <span className="text-[15px]">Resolution</span>
                <Segmented
                  kind="radio"
                  label="Resolution"
                  segments={resolutions.map((r) => ({ value: r.height, label: r.label }))}
                  value={chosen}
                  onChange={(value) => value !== null && setHeight(value)}
                  // Sunk a little in dark, where the group is already the track's grey.
                  className="w-full sm:w-auto dark:bg-black/30"
                  segmentClassName="flex-1 px-3 tabular-nums sm:flex-none"
                />
              </div>
            )}
          </div>
          <p className="mt-1.5 px-4 text-[13px] text-muted-foreground">
            {savedAs
              ? `Downloads as "${savedAs}", with the extension for the format.`
              : "Leave blank to use the video's own filename."}
          </p>
          {choice === "mp4" && resolutions.length > 0 && (
            // Offered only up to the source's own size (v1.1.0): never an upscale.
            <p className="mt-1 px-4 text-[13px] text-muted-foreground">
              {options?.source_height && `Source: ${options.source_height}p. `}
              {chosenOption?.native
                ? "The source's own size: nothing is resampled."
                : `Scaled down to ${chosenOption?.label ?? ""}.`}
              {options?.hardware_encoder ? " GPU encoding." : ""}
            </p>
          )}
        </div>

        {burn && (
          <div className={cn(GROUP, "px-4 py-3")} role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-[15px]">
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                Rendering the video with captions
              </span>
              <span className="font-medium tabular-nums">{burn.progress}%</span>
            </div>
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-surface-3 dark:bg-background">
              <div
                className="bar-fill h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${burn.progress}%` }}
              />
            </div>
            {eta && <p className="mt-1.5 text-[13px] text-muted-foreground">{eta}</p>}
          </div>
        )}

        {failed && <Notice role="alert" tone="error" className="dark:bg-surface-3" title={(failed as Error).message} />}

        <div>
          <div className="mb-1.5 flex items-baseline justify-between px-4">
            <p className="label-caps">Previous exports for this video</p>
            <span className="text-[13px] tabular-nums text-muted-foreground">
              {items.length} file{items.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className={GROUP}>
            {isLoading && <Skeleton className="m-4 h-10" />}

            {!isLoading && items.length === 0 && (
              <p className="group-row justify-center text-[13px] text-muted-foreground">No exports yet.</p>
            )}

            {items.map((item) => {
              const Icon = ICONS[item.format] ?? FileText;
              return (
                <div key={item.id} className="group-row justify-start gap-3">
                  <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px]">
                      <span className="uppercase">{item.format}</span>
                      {item.height ? <span> · {item.height}p</span> : null}
                    </p>
                    <LanguageLine item={item} options={languages} />
                    <StatusLine item={item} />
                  </div>
                  <Button
                    variant="plain"
                    size="sm"
                    onClick={() => download.mutate({ exportId: item.id, name: savedAs || undefined })}
                    disabled={item.status !== "completed" || download.isPending}
                    aria-label={`Download ${item.format}`}
                  >
                    <Download />
                    <span className="max-sm:sr-only">Download</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => deleteExport.mutate(item.id)}
                    title="Delete this export"
                    aria-label={`Delete ${item.format} export`}
                    className="hover:text-destructive"
                  >
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-3 px-6 pb-6 pt-3">
        <p className="hidden min-w-0 flex-1 text-[13px] text-muted-foreground sm:block">
          {rendering
            ? "Burning captions in re-encodes the video. Download appears when it finishes."
            : choice === "original"
              ? "Downloads straight away."
              : "Appears in the list above; download it from there."}
        </p>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
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
