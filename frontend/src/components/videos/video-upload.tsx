"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FileVideo, Loader2, Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { statsKeys } from "@/hooks/use-stats";
import { videoKeys } from "@/hooks/use-videos";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/format";
import { uploadVideo, type UploadHandle } from "@/lib/upload";
import { ACCEPTED_EXTENSIONS, ACCEPTED_VIDEO_TYPES } from "@/types/video";

interface ActiveUpload {
  file: File;
  percent: number;
  handle: UploadHandle;
}

function isAcceptedFile(file: File): boolean {
  if (ACCEPTED_VIDEO_TYPES.includes(file.type)) return true;
  // Some systems report an empty or odd MIME type for .mkv and .mov, so fall
  // back to the extension. The backend re-checks both regardless.
  const dot = file.name.lastIndexOf(".");
  return dot !== -1 && ACCEPTED_EXTENSIONS.includes(file.name.slice(dot).toLowerCase());
}

export function VideoUpload() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [active, setActive] = useState<ActiveUpload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // dragenter/dragleave fire for every child element, so a boolean flag
  // flickers as the pointer moves across the zone. Counting entries and exits
  // is the standard fix.
  const dragDepth = useRef(0);

  const startUpload = useCallback(
    (file: File) => {
      setError(null);

      if (!isAcceptedFile(file)) {
        setError(`${file.name} isn't a supported video format`);
        return;
      }

      const handle = uploadVideo(file, (percent) =>
        setActive((current) => (current ? { ...current, percent } : current))
      );

      setActive({ file, percent: 0, handle });

      handle.promise
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: videoKeys.all });
          void queryClient.invalidateQueries({ queryKey: statsKeys.all });
        })
        .catch((err: Error) => {
          if (err.message !== "Upload cancelled") setError(err.message);
        })
        .finally(() => setActive(null));
    },
    [queryClient]
  );

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);

    const file = event.dataTransfer.files?.[0];
    if (file) startUpload(file);
  };

  if (active) {
    return (
      <Card className="animate-fade-in p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileVideo className="size-4" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{active.file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(active.file.size)}
            </p>
          </div>

          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {active.percent}%
          </span>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => active.handle.cancel()}
            aria-label="Cancel upload"
          >
            <X />
          </Button>
        </div>

        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={active.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-200 ease-out"
            style={{ width: `${active.percent}%` }}
          />
        </div>

        {active.percent >= 100 && (
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {/* The bar hits 100% when the bytes are sent, but the server is
                still probing and generating a thumbnail. */}
            Processing on the server…
          </p>
        )}
      </Card>
    );
  }

  return (
    <div>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-200 sm:p-10",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border bg-subtle hover:border-muted-foreground/40 hover:bg-muted/50"
        )}
      >
        <span
          className={cn(
            "flex size-11 items-center justify-center rounded-xl transition-all duration-200 ease-out",
            dragging
              ? "scale-110 bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground group-hover:scale-105"
          )}
        >
          <Upload className="size-5" />
        </span>

        <p className="mt-3.5 text-sm font-medium">
          {dragging ? (
            "Drop to upload"
          ) : (
            <>
              Drop a video here, or <span className="text-primary">browse</span>
            </>
          )}
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {ACCEPTED_EXTENSIONS.join("  ·  ")}
        </p>

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={[...ACCEPTED_VIDEO_TYPES, ...ACCEPTED_EXTENSIONS].join(",")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) startUpload(file);
            // Reset so re-picking the same file fires onChange again.
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
