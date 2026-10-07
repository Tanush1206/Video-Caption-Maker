"use client";

import {
  AlertTriangle,
  Download,
  FileCode,
  FileText,
  Film,
  Loader2,
  Trash2,
  Video,
} from "lucide-react";

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
  hint: string;
  icon: typeof FileText;
}[] = [
  { key: "mp4", label: "MP4", hint: "Captions burned in", icon: Film },
  { key: "original", label: "Original", hint: "As uploaded", icon: Video },
  { key: "srt", label: "SRT", hint: "Subtitle file", icon: FileText },
  { key: "vtt", label: "VTT", hint: "For the web", icon: FileText },
  { key: "json", label: "JSON", hint: "With timings", icon: FileCode },
];

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
}: {
  videoId: number;
  hasCaptions: boolean;
  /** The video's title, as the starting point for the saved filename. */
  defaultName: string;
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

  return (
    // No dividing border any more: this is a tab of its own rather than the
    // lower half of the rail, so there is nothing above it to be divided from.
    <section>
      {(createExport.isPending || downloadOriginal.isPending) && (
        <div className="mb-3 flex justify-end">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Says what is unavailable, not that nothing is. This used to read
          "Nothing to export until this video has captions", which was wrong the
          moment the original moved in here — and was wrong before that too, it
          just pointed at a control on the other side of the screen. */}
      {!hasCaptions && (
        <p className="mb-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Captions aren&apos;t ready yet. You can still download the original.
        </p>
      )}

      {/* Only shown once the server has said what it can do. It applies to the
          MP4 tile alone, so it sits directly above the grid rather than inside
          it — a tile that changed shape when selected would be worse. */}
      {resolutions.length > 0 && (
        <div className="mb-2 rounded-md border border-border/70 bg-background/30 px-2.5 py-2">
          <label
            htmlFor="export-resolution"
            className="flex items-center justify-between gap-2"
          >
            <span className="text-[11px] font-semibold">MP4 resolution</span>
            <select
              id="export-resolution"
              value={chosen ?? ""}
              onChange={(event) => setHeight(Number(event.target.value))}
              className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] tabular-nums"
            >
              {resolutions.map((resolution) => (
                <option key={resolution.height} value={resolution.height}>
                  {resolution.label}
                  {resolution.height === recommended
                    ? " · recommended"
                    : resolution.native
                      ? " · source"
                      : resolution.upscaled
                        ? " · upscaled"
                        : ""}
                </option>
              ))}
            </select>
          </label>

          {/* Said plainly, because "1080p" on a 144p source promises something
              it cannot deliver. Upscaling buys sharp captions and nothing else
              — the picture has no extra detail to recover — and that is worth
              having when the alternative is a 6px caption, but only if the
              trade is stated rather than implied. */}
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
            {chosenOption?.upscaled
              ? `Upscaled from ${options?.source_height}p — captions are drawn sharp at ${chosenOption.label}, the picture gains no detail. At ${options?.source_height}p they would render too small to read.`
              : chosenOption?.native
                ? "The source's own size — nothing is resampled."
                : `Rendered at ${chosenOption?.label ?? ""}.`}
            {options?.hardware_encoder ? " GPU encoding." : ""}
          </p>
        </div>
      )}

      {/* Directly above the format buttons, because it applies to whichever
          one gets pressed — including the download buttons further down the
          list of finished exports. Below the resolution picker, since that
          only concerns the MP4 and this concerns everything. */}
      <div className="mb-2 rounded-md border border-border/70 bg-background/30 px-2.5 py-2">
        <label htmlFor="export-name" className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] font-semibold">Save as</span>
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
            className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
          />
        </label>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          {savedAs
            ? `Downloads as "${savedAs}", with the extension for the format you pick.`
            : "Leave blank to use the video's own filename."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {FORMATS.map(({ key, label, hint, icon: Icon }) => {
          const original = key === "original";
          const disabled = original
            ? downloadOriginal.isPending
            : !hasCaptions || createExport.isPending || (key === "mp4" && rendering);

          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() =>
                original
                  ? downloadOriginal.mutate(savedAs || undefined)
                  : createExport.mutate({
                      format: key,
                      // Only a burn has a frame size; the server drops it for
                      // the sidecars anyway, but not sending it is clearer.
                      height: key === "mp4" && chosen ? chosen : undefined,
                    })
              }
              title={
                original
                  ? "The file you uploaded, untouched — no captions"
                  : key === "mp4"
                    ? "Captions drawn into the video itself"
                    : hint
              }
              className={cn(
                "group flex items-center gap-2.5 rounded-md border border-border/70 bg-background/30 px-2.5 py-2 text-left transition-colors",
                "hover:border-primary/50 hover:bg-primary/10",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border/70 disabled:hover:bg-background/30",
                // Five tiles in a two-column grid. The odd one out is the last,
                // and it is the transcript format that matters least, so JSON
                // takes the full width rather than leaving a hole.
                key === "json" && "col-span-2"
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary group-disabled:bg-muted group-disabled:text-muted-foreground">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {failed && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {(failed as Error).message}
        </p>
      )}

      {/* Rendering a long video takes minutes, so say so rather than leaving
          someone watching a spinner wondering if it's stuck. */}
      {rendering && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Burning captions in re-encodes the video — this can take a few minutes.
        </p>
      )}

      <div className="mt-3 space-y-1.5">
        {isLoading && <Skeleton className="h-10" />}

        {!isLoading && items.length === 0 && (
          <p className="py-2 text-center text-xs text-muted-foreground">
            No exports yet.
          </p>
        )}

        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-md border border-border/60 bg-background/30 px-2.5 py-2"
          >
            <span className="w-9 shrink-0 rounded bg-muted py-0.5 text-center font-mono text-[10px] font-semibold uppercase text-muted-foreground">
              {item.format}
            </span>

            <div className="min-w-0 flex-1">
              <StatusLine item={item} />
              {item.status === "processing" && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-500 ease-out"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => download.mutate({ exportId: item.id, name: savedAs || undefined })}
              disabled={item.status !== "completed" || download.isPending}
              title="Download"
              aria-label={`Download ${item.format}`}
              className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => deleteExport.mutate(item.id)}
              title="Delete this export"
              aria-label={`Delete ${item.format} export`}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
