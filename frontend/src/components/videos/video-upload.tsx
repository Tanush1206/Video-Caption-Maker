"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FileVideo, Loader2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { Stepper } from "@/components/flow/stepper";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { statsKeys } from "@/hooks/use-stats";
import { useSystem } from "@/hooks/use-system";
import { useLanguageOptions, videoKeys } from "@/hooks/use-videos";
import { formatFileSize } from "@/lib/format";
import { askToNotify, watchTranscription } from "@/lib/transcription-alerts";
import { uploadVideo, type UploadHandle } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { ACCEPTED_EXTENSIONS, ACCEPTED_VIDEO_TYPES } from "@/types/video";

function isAcceptedFile(file: File): boolean {
  if (ACCEPTED_VIDEO_TYPES.includes(file.type)) return true;
  // Some systems report an empty or odd MIME type for .mkv and .mov, so fall
  // back to the extension. The backend re-checks both regardless.
  const dot = file.name.lastIndexOf(".");
  return dot !== -1 && ACCEPTED_EXTENSIONS.includes(file.name.slice(dot).toLowerCase());
}

/**
 * Steps 1 and 2 of Upload → Language → Export.
 *
 * The file is picked first but not sent until a language is chosen: the
 * language travels with the upload, so the one transcription that follows
 * produces the captions that were asked for instead of a default to redo.
 * Step 3 lives on the video's own page, which this navigates to as soon as
 * the upload lands.
 */
export function VideoUpload() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: languageOptions } = useLanguageOptions();
  const { data: system } = useSystem();

  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("same");
  const [upload, setUpload] = useState<{ percent: number; handle: UploadHandle } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // dragenter/dragleave fire for every child element, so a boolean flag
  // flickers as the pointer moves across the zone. Counting entries and exits
  // is the standard fix.
  const dragDepth = useRef(0);

  const choose = useCallback((picked: File) => {
    setError(null);
    if (!isAcceptedFile(picked)) {
      setError(
        `"${picked.name}" isn't a video this app can read. Use ${ACCEPTED_EXTENSIONS.join(", ")}.`
      );
      return;
    }
    setFile(picked);
  }, []);

  function start() {
    if (!file) return;
    setError(null);
    // Asked here, on a click, because browsers only show the permission
    // prompt in response to one. The job outlasts most people's patience.
    askToNotify();

    const handle = uploadVideo(
      file,
      (percent) => setUpload((current) => (current ? { ...current, percent } : current)),
      language
    );
    setUpload({ percent: 0, handle });

    handle.promise
      .then((video) => {
        watchTranscription(video.id);
        void queryClient.invalidateQueries({ queryKey: videoKeys.all });
        void queryClient.invalidateQueries({ queryKey: statsKeys.all });
        router.push(`/editor/${video.id}`);
      })
      .catch((err: Error) => {
        setUpload(null);
        if (err.message !== "Upload cancelled") setError(err.message);
      });
  }

  const step = file ? 2 : 1;
  const translating = language !== "same";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h2">Caption a video</h2>
        <Stepper current={step} />
      </div>

      <div className="mt-4">
        {!file ? (
          // A <label> wrapping the input, rather than a div with a click
          // handler: it is focusable and opens the picker from the keyboard
          // with no extra wiring, and the drop handlers sit on it unchanged.
          <label
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
            onDrop={(event) => {
              event.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              const dropped = event.dataTransfer.files?.[0];
              if (dropped) choose(dropped);
            }}
            className={cn(
              "group flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors duration-200 sm:py-10",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
              dragging
                ? "border-primary bg-primary/5"
                : // Translucent, not `bg-subtle`. On glass an opaque fill punches a
                  // solid rectangle through the panel and the whole effect stops
                  // at its edges.
                  "border-border/70 bg-background/30 hover:border-primary/40 hover:bg-background/60"
            )}
          >
            <span
              className={cn(
                "flex size-11 items-center justify-center rounded-lg transition-all duration-200 ease-out",
                dragging
                  ? "scale-110 bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground group-hover:scale-105"
              )}
            >
              <Upload className="size-5" aria-hidden="true" />
            </span>
            <span className="mt-3.5 text-sm font-medium">
              {dragging ? (
                "Drop to choose this video"
              ) : (
                <>
                  Drop a video here, or <span className="text-primary">browse</span>
                </>
              )}
            </span>
            <span className="mt-1 font-mono text-body-sm text-muted-foreground">
              {ACCEPTED_EXTENSIONS.join("  ·  ")}
            </span>
            <input
              type="file"
              className="sr-only"
              accept={[...ACCEPTED_VIDEO_TYPES, ...ACCEPTED_EXTENSIONS].join(",")}
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) choose(picked);
                // Reset so re-picking the same file fires onChange again.
                e.target.value = "";
              }}
            />
          </label>
        ) : (
          <div className="animate-fade-in rounded-lg border border-border bg-background/40 p-4">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileVideo className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={file.name}>
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
              </div>
              {!upload && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFile(null)}
                  aria-label="Choose a different video"
                >
                  Change
                </Button>
              )}
            </div>

            {!upload ? (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="sm:w-72">
                  <Select
                    label="Caption language"
                    name="caption_language"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    disabled={!languageOptions}
                  >
                    {(languageOptions?.caption ?? [{ code: "same", label: "Same as spoken" }]).map(
                      (option) => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      )
                    )}
                  </Select>
                </div>
                <Button onClick={start} className="sm:ml-auto">
                  Generate captions
                  <ArrowRight />
                </Button>
              </div>
            ) : (
              <div className="mt-4">
                <div className="flex items-center justify-between text-body-sm text-muted-foreground">
                  <span className="flex items-center gap-2">
                    {upload.percent >= 100 && <Loader2 className="size-3.5 animate-spin" />}
                    {/* The bar hits 100% when the bytes are sent, but the server
                        is still probing the file and making a thumbnail. */}
                    {upload.percent < 100 ? "Uploading…" : "Preparing…"}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono tabular-nums">{upload.percent}%</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => upload.handle.cancel()}
                      aria-label="Cancel upload"
                    >
                      <X />
                    </Button>
                  </span>
                </div>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label="Upload progress"
                  aria-valuenow={upload.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-200 ease-out"
                    style={{ width: `${upload.percent}%` }}
                  />
                </div>
              </div>
            )}

            {!upload && (
              <p className="mt-3 text-xs text-muted-foreground">
                {translating
                  ? system?.translation_engine === "gemini"
                    ? "Speech is transcribed on this computer, then translated with Gemini."
                    : "Speech is transcribed and translated on this computer."
                  : "Captions come out in whatever language is spoken. It's detected automatically."}
              </p>
            )}
          </div>
        )}
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
