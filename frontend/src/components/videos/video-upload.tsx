"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

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
      <div className="rounded-lg border border-border p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{active.file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(active.file.size)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => active.handle.cancel()}
            className="rounded-md p-1.5 transition hover:bg-muted"
            aria-label="Cancel upload"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={active.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${active.percent}%` }}
          />
        </div>

        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          {active.percent >= 100 ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {/* The bar hits 100% when the bytes are sent, but the server is
                  still probing and generating a thumbnail. */}
              Processing on the server…
            </>
          ) : (
            `Uploading… ${active.percent}%`
          )}
        </p>
      </div>
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
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition",
          dragging ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
        )}
      >
        <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">
          Drop a video here, or <span className="text-primary">browse</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {ACCEPTED_EXTENSIONS.join(", ")}
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
        <p role="alert" className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
