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

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCreateExport,
  useDeleteExport,
  useDownloadExport,
  useExports,
} from "@/hooks/use-exports";
import { useDownloadOriginal } from "@/hooks/use-stream";
import { formatFileSize, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExportFormat, VideoExport } from "@/types/export";

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
      {item.size_bytes ? formatFileSize(item.size_bytes) : "—"} ·{" "}
      {formatRelativeTime(item.created_at)}
    </span>
  );
}

export function ExportPanel({
  videoId,
  hasCaptions,
}: {
  videoId: number;
  hasCaptions: boolean;
}) {
  const { data, isLoading } = useExports(videoId);
  const createExport = useCreateExport(videoId);
  const deleteExport = useDeleteExport(videoId);
  const download = useDownloadExport();
  const downloadOriginal = useDownloadOriginal(videoId);

  const items = data?.items ?? [];
  // One burn at a time is enough; a second would queue behind it and produce a
  // duplicate file nobody asked for.
  const rendering = items.some(
    (item) => item.format === "mp4" && (item.status === "pending" || item.status === "processing")
  );

  const failed = createExport.error ?? downloadOriginal.error;

  return (
    <Card className="p-3">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="label-caps">
          Export
        </h2>
        {(createExport.isPending || downloadOriginal.isPending) && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
      </header>

      {/* Says what is unavailable, not that nothing is. This used to read
          "Nothing to export until this video has captions", which was wrong the
          moment the original moved in here — and was wrong before that too, it
          just pointed at a control on the other side of the screen. */}
      {!hasCaptions && (
        <p className="mb-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Captions aren&apos;t ready yet. You can still download the original.
        </p>
      )}

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
                original ? downloadOriginal.mutate() : createExport.mutate(key)
              }
              title={
                original
                  ? "The file you uploaded, untouched — no captions"
                  : key === "mp4"
                    ? "Captions drawn into the video itself"
                    : hint
              }
              className={cn(
                "group flex items-center gap-2.5 rounded-md border border-border bg-subtle px-2.5 py-2 text-left transition-colors",
                "hover:border-primary/50 hover:bg-primary/5",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-subtle",
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
            className="flex items-center gap-2 rounded-md border border-border/60 bg-subtle px-2.5 py-2"
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
              onClick={() => download.mutate(item.id)}
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
    </Card>
  );
}
