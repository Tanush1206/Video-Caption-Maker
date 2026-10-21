"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, FolderOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Stepper } from "@/components/flow/stepper";
import { LanguageStep } from "@/components/videos/language-step";
import { statsKeys } from "@/hooks/use-stats";
import { useSystem } from "@/hooks/use-system";
import { useLanguageOptions, useRetranscribe, videoKeys } from "@/hooks/use-videos";
import { api } from "@/lib/api";
import { DETECTION_WAIT_MS, scriptQuestion, startRequest, type ScriptChoice } from "@/lib/hindi-script";
import { askToNotify, watchTranscription } from "@/lib/transcription-alerts";
import { uploadVideo, type UploadHandle } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { ACCEPTED_EXTENSIONS, ACCEPTED_VIDEO_TYPES, type Video } from "@/types/video";

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
 * The file uploads as soon as it is picked, held (v1.0.9): the server listens
 * to the first 30 s while the caption language is chosen, so the step can
 * ask how Hindi is written before anything is transcribed. Start sends the
 * choice (POST …/transcribe) and goes to the video's own page, where step 3
 * lives. Back, or leaving the page, deletes the upload and its files.
 */
export function VideoUpload() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: languageOptions } = useLanguageOptions();
  const { data: system } = useSystem();

  const retranscribe = useRetranscribe();

  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("same");
  const [upload, setUpload] = useState<{ percent: number; handle: UploadHandle } | null>(null);
  const [uploaded, setUploaded] = useState<Video | null>(null);
  const [uploadedAt, setUploadedAt] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [script, setScript] = useState<ScriptChoice | null>(null);
  // Start pressed before the upload finished: start as soon as it lands.
  const [startWhenUploaded, setStartWhenUploaded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The held video, polled until detection answers.
  const { data: held } = useQuery({
    queryKey: videoKeys.detail(uploaded?.id ?? 0),
    queryFn: () => api.get<Video>(`/api/videos/${uploaded?.id}`),
    enabled: uploaded !== null,
    initialData: uploaded ?? undefined,
    refetchInterval: (query) => (query.state.data?.detected_language ? false : 1000),
  });
  const detected = held?.detected_language ?? null;
  const confidence = held?.detected_confidence ?? null;

  // Detection that hasn't answered in time asks without a preset.
  useEffect(() => {
    if (uploadedAt === null || detected !== null) return;
    const wait = setTimeout(
      () => setTimedOut(true),
      Math.max(0, uploadedAt + DETECTION_WAIT_MS - Date.now())
    );
    return () => clearTimeout(wait);
  }, [uploadedAt, detected]);

  const question = scriptQuestion({
    detected,
    confidence,
    timedOut,
    captionLanguage: language,
    minConfidence: languageOptions?.hinglish_min_confidence ?? 0.7,
  });

  // The preset follows what was heard, until someone picks.
  const picked = useRef(false);
  useEffect(() => {
    if (!picked.current) setScript(question.preset);
  }, [question.preset]);

  // Leaving with an upload that was never started deletes it, files and all.
  // `keepalive` lets the request finish after the tab has gone.
  const abandoned = useRef<number | null>(null);
  abandoned.current = uploaded && !starting ? uploaded.id : null;
  useEffect(() => {
    const leave = () => {
      if (abandoned.current === null) return;
      void api.deleteOnExit(`/api/videos/${abandoned.current}`).catch(() => undefined);
      abandoned.current = null;
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      // Navigating elsewhere in the app unmounts this without a pagehide.
      leave();
    };
  }, []);

  function reset() {
    picked.current = false;
    setScript(null);
    setUploaded(null);
    setUploadedAt(null);
    setTimedOut(false);
    setStartWhenUploaded(false);
    setStarting(false);
  }

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
    reset();

    const handle = uploadVideo(
      picked,
      (percent) => setUpload((current) => (current ? { ...current, percent } : current)),
      undefined,
      true
    );
    setUpload({ percent: 0, handle });
    handle.promise
      .then((video) => {
        setUploaded(video);
        setUploadedAt(Date.now());
      })
      .catch((err: Error) => {
        setUpload(null);
        setFile(null);
        setStartWhenUploaded(false);
        if (err.message !== "Upload cancelled") setError(err.message);
      });
  }, []);

  function back() {
    upload?.handle.cancel();
    if (uploaded) void api.delete(`/api/videos/${uploaded.id}`).catch(() => undefined);
    abandoned.current = null;
    reset();
    setUpload(null);
    setFile(null);
  }

  function chooseScript(choice: ScriptChoice) {
    picked.current = true;
    setScript(choice);
  }

  const start = useCallback(() => {
    setError(null);
    // Asked here, on a click, because browsers only show the permission
    // prompt in response to one. The job outlasts most people's patience.
    askToNotify();
    if (!uploaded) {
      setStartWhenUploaded(true);
      return;
    }
    setStarting(true);
    retranscribe.mutate(
      { id: uploaded.id, ...startRequest(question.show ? script : null, language) },
      {
        onSuccess: (video) => {
          watchTranscription(video.id);
          void queryClient.invalidateQueries({ queryKey: videoKeys.all });
          void queryClient.invalidateQueries({ queryKey: statsKeys.all });
          router.push(`/editor/${video.id}`);
        },
        onError: (err) => {
          setStarting(false);
          setError(err.message);
        },
      }
    );
  }, [uploaded, question.show, script, language, retranscribe, queryClient, router]);

  // Start was pressed while uploading: it goes once the upload has landed.
  useEffect(() => {
    if (startWhenUploaded && uploaded && !starting) {
      setStartWhenUploaded(false);
      start();
    }
  }, [startWhenUploaded, uploaded, starting, start]);

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
            upload={uploaded ? null : upload}
            detection={{
              detected,
              confidence,
              listening: uploaded !== null && detected === null && !timedOut,
            }}
            question={question}
            script={script}
            onScript={chooseScript}
            waitingToStart={startWhenUploaded}
            starting={starting}
            onBack={back}
            onStart={start}
            onCancel={back}
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
