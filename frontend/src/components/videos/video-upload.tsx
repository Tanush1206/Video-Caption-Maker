"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Stepper } from "@/components/flow/stepper";
import { Notice } from "@/components/ui/notice";
import { LanguageStep } from "@/components/videos/language-step";
import { statsKeys } from "@/hooks/use-stats";
import { useSystem } from "@/hooks/use-system";
import { useLanguageOptions, useRetranscribe, videoKeys } from "@/hooks/use-videos";
import { api } from "@/lib/api";
import { DETECTION_WAIT_MS, scriptQuestion, startRequest, type ScriptChoice } from "@/lib/hindi-script";
import { isOfferedSpeech, TRY_ANYWAY } from "@/lib/languages";
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
 * ask how Hindi is written before anything is transcribed, and so speech in
 * a language not offered is said before captions are made of it (v1.0.11).
 * Start sends the choice (POST …/transcribe) and goes to the video's own
 * page, where step 3 lives. Back, or leaving the page, deletes the upload
 * and its files.
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
  // For speech heard in a language not offered: one chosen instead, or
  // TRY_ANYWAY. Nothing until someone chooses.
  const [spoken, setSpoken] = useState<string | null>(null);
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
  const unsupported =
    detected !== null && languageOptions !== undefined && !isOfferedSpeech(detected, languageOptions);
  const chosenSpoken = unsupported && spoken !== null && spoken !== TRY_ANYWAY ? spoken : null;

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
    detected: chosenSpoken ?? detected,
    confidence: chosenSpoken ? null : confidence,
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
    setSpoken(null);
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

  function chooseSpoken(choice: string) {
    // A script picked for what was heard doesn't carry over to another language.
    picked.current = false;
    setScript(null);
    setSpoken(choice);
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
      { id: uploaded.id, ...startRequest(question.show ? script : null, language, chosenSpoken) },
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
  }, [uploaded, question.show, script, language, chosenSpoken, retranscribe, queryClient, router]);

  // Start was pressed while uploading: it goes once the upload has landed.
  useEffect(() => {
    if (startWhenUploaded && uploaded && !starting) {
      setStartWhenUploaded(false);
      start();
    }
  }, [startWhenUploaded, uploaded, starting, start]);

  const step = file ? 2 : 1;

  return (
    <div className="space-y-6">
      <h2 className="sr-only">Caption a video</h2>
      {/* Where you are, once a file is picked. The hardware readout lives in
          Settings (v1.1.0). */}
      {file && <Stepper current={step} className="mx-auto max-w-[880px]" />}

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
              // A dashed hairline, a small icon, one line of text, one button;
              // about 140 px tall.
              "flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed px-4 py-5 text-center",
              "transition-colors duration-200 ease-out",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
              dragging ? "border-accent bg-primary-muted" : "border-input hover:bg-surface-2/60"
            )}
          >
            <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
            <span className="text-[15px] text-muted-foreground">
              {dragging ? "Drop to choose this video" : "Drop a video here, or choose one. Everything runs on this computer."}
            </span>
            {/* Looks like a button; the whole zone is the <label>, so a click
                anywhere opens the picker. */}
            <span
              aria-hidden="true"
              className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-[15px] font-medium text-primary-foreground transition-colors duration-200 ease-out sm:h-9"
            >
              Choose video
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
            unsupported={unsupported}
            spoken={spoken}
            onSpoken={chooseSpoken}
            waitingToStart={startWhenUploaded}
            starting={starting}
            onBack={back}
            onStart={start}
            onCancel={back}
          />
        )}
      </div>

      {error && <Notice role="alert" tone="error" title={error} />}
    </div>
  );
}
