"use client";

import {
  AlertTriangle,
  Download,
  FileCode,
  FileText,
  Film,
  Loader2,
  Trash2,
} from "lucide-react";

import {
  useCreateExport,
  useDeleteExport,
  useDownloadExport,
  useExports,
} from "@/hooks/use-exports";
import { formatFileSize, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExportFormat, VideoExport } from "@/types/export";

const FORMATS: {
  key: ExportFormat;
  label: string;
  hint: string;
  icon: typeof FileText;
}[] = [
  { key: "srt", label: "SRT", hint: "Subtitle file", icon: FileText },
  { key: "vtt", label: "VTT", hint: "For the web", icon: FileText },
  { key: "json", label: "JSON", hint: "With timings", icon: FileCode },
  { key: "mp4", label: "MP4", hint: "Burned in", icon: Film },
];

function StatusLine({ item }: { item: VideoExport }) {
  if (item.status === "failed") {
    return (
      <span className="flex items-center gap-1 text-xs text-red-500">
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

  const items = data?.items ?? [];
  // One burn at a time is enough; a second would queue behind it and produce a
  // duplicate file nobody asked for.
  const rendering = items.some(
    (item) => item.format === "mp4" && (item.status === "pending" || item.status === "processing")
  );

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Export
        </h2>
        {createExport.isPending && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
      </header>

      {!hasCaptions && (
        <p className="mb-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Nothing to export until this video has captions.
        </p>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {FORMATS.map(({ key, label, hint, icon: Icon }) => {
          const disabled =
            !hasCaptions || createExport.isPending || (key === "mp4" && rendering);

          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => createExport.mutate(key)}
              title={key === "mp4" ? "Captions drawn into the video itself" : hint}
              className={cn(
                "flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-left transition",
                "hover:border-primary hover:bg-primary/10",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent"
              )}
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-xs font-medium">{label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {createExport.isError && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          {(createExport.error as Error).message}
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
        {isLoading && <div className="h-10 animate-pulse rounded-md bg-muted" />}

        {!isLoading && items.length === 0 && (
          <p className="py-2 text-center text-xs text-muted-foreground">
            No exports yet.
          </p>
        )}

        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-2"
          >
            <span className="w-10 shrink-0 font-mono text-[11px] uppercase text-muted-foreground">
              {item.format}
            </span>

            <div className="min-w-0 flex-1">
              <StatusLine item={item} />
              {item.status === "processing" && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-[width]"
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
              className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
