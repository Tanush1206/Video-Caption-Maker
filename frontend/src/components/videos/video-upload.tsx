"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FileUp, FolderOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { Stepper } from "@/components/flow/stepper";
import { LanguageStep } from "@/components/videos/language-step";
import { statsKeys } from "@/hooks/use-stats";
import { useSystem } from "@/hooks/use-system";
import { useLanguageOptions, videoKeys } from "@/hooks/use-videos";
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

  const hardware = system?.hardware;
  const localOnly = system?.translation_engine !== "gemini";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 sm:px-6">
        <h2 className="sr-only">Caption a video</h2>
        <Stepper current={step} />
        {/* What the transcription will run on, from the worker's own report. */}
        {hardware && (
          <span
            className={cn(
              "hidden shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] sm:inline-flex",
              hardware.cuda
                ? "border-success/30 bg-success/10 text-success"
                : "border-border bg-surface-2 text-muted-foreground"
            )}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {hardware.cuda ? "CUDA enabled" : "CPU"}
          </span>
        )}
      </div>

      <div>
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
              "group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed px-4 py-10 text-center transition-colors duration-200 sm:p-10",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
              dragging
                ? "border-primary bg-primary/10"
                : "border-primary/40 bg-primary/[0.03] hover:border-primary hover:bg-primary/[0.06]"
            )}
          >
            <span
              className={cn(
                "mb-4 flex size-14 items-center justify-center rounded-lg border border-border transition-transform duration-200 ease-out",
                dragging
                  ? "scale-110 bg-primary text-primary-foreground"
                  : "bg-surface-2 text-primary group-hover:scale-105"
              )}
            >
              <FileUp className="size-7" aria-hidden="true" />
            </span>
            <span className="text-xl font-semibold tracking-tight sm:text-2xl">
              {dragging ? (
                "Drop to choose this video"
              ) : (
                <>
                  <span className="sm:hidden">Tap or drop a video to caption it</span>
                  <span className="hidden sm:inline">Drop a video to caption it</span>
                </>
              )}
            </span>
            <span className="mt-2 max-w-xl text-sm text-muted-foreground">
              {localOnly
                ? "Transcribe and translate locally on your machine. Private, no cloud required."
                : "Transcribed locally on your machine. Translations into another language use Gemini."}
            </span>
            <span className="mt-4 flex flex-wrap justify-center gap-1.5">
              {ACCEPTED_EXTENSIONS.map((extension) => (
                <span
                  key={extension}
                  className="rounded-sm border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] uppercase text-muted-foreground"
                >
                  {extension.slice(1)}
                </span>
              ))}
            </span>
            {/* Looks like a button; the whole zone is the <label>, so a click
                anywhere opens the picker. */}
            <span
              aria-hidden="true"
              className="mt-6 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/30 transition-colors group-hover:bg-primary/90"
            >
              <FolderOpen className="size-4" />
              Browse files
            </span>
            <input
              type="file"
              className="sr-only"
              aria-label="Choose a video to caption"
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
          <LanguageStep
            file={file}
            language={language}
            onLanguage={setLanguage}
            options={languageOptions}
            system={system}
            upload={upload}
            onBack={() => setFile(null)}
            onStart={start}
            onCancel={() => upload?.handle.cancel()}
          />
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
