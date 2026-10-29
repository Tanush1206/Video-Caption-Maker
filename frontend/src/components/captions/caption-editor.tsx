"use client";

import { FileText, Loader2, Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccuracyInfo } from "@/components/captions/accuracy-info";
import { CaptionRow } from "@/components/captions/caption-row";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EMPHASIS,
  NO_EMPHASIS,
  useCreateCaption,
  useDeleteCaption,
  useMergeCaption,
  useSplitCaption,
  useUpdateCaption,
  useVideoCaptions,
} from "@/hooks/use-captions";
import type { Playback } from "@/hooks/use-playback";
import { Select } from "@/components/ui/select";
import { LanguagePicker } from "@/components/videos/language-picker";
import { useLanguageOptions, useRetranscribe } from "@/hooks/use-videos";
import { languageName } from "@/lib/languages";
import { askToNotify, watchTranscription } from "@/lib/transcription-alerts";
import type { Video } from "@/types/video";

/** How long a hand-added caption starts out, before anyone drags its timing. */
const NEW_CAPTION_MS = 2000;

interface CaptionEditorProps {
  video: Video;
  playback: Playback;
}

export function CaptionEditor({ video, playback }: CaptionEditorProps) {
  const { data, isLoading, isError, error } = useVideoCaptions(video.id);

  const updateCaption = useUpdateCaption(video.id);
  const splitCaption = useSplitCaption(video.id);
  const mergeCaption = useMergeCaption(video.id);
  const deleteCaption = useDeleteCaption(video.id);
  const createCaption = useCreateCaption(video.id);
  const retranscribe = useRetranscribe();
  const { data: languageOptions } = useLanguageOptions();
  const router = useRouter();

  /**
   * The language choice, held locally until "Redo" applies it.
   *
   * Deliberately not applied on change: re-transcribing is minutes of GPU and
   * throws away every caption edit made since, so it happens when someone asks
   * for it rather than because a select lost focus.
   *
   * One question, not two. There used to be a "spoken" picker beside this one,
   * because naming the language measurably improved Whisper — but it asked the
   * user to answer something the app can work out, in service of a distinction
   * (what is being said vs what the captions should say) that only matters
   * when the two differ. Detection plus `languages.TRANSCRIPTION_SUBSTITUTES`
   * now reaches the same answer on both files that motivated the control.
   */
  const [captionLanguage, setCaptionLanguage] = useState(video.caption_language);
  // How Hindi is written, offered when Hindi was heard and the captions are
  // Hindi (v1.0.9). A video from before it was Devanagari.
  const [hindiScript, setHindiScript] = useState(
    video.hindi_script === "roman" ? "roman" : "devanagari"
  );
  // Offered unless the video is known not to be Hindi: one made before v1.0.9
  // has nothing recorded until its next job, and without the choice its Redo
  // stayed in Devanagari (v1.0.10).
  const maybeHindi =
    video.detected_language === null ||
    video.detected_language === "hi" ||
    video.spoken_language === "hi";
  const offerScript = maybeHindi && (captionLanguage === "same" || captionLanguage === "hi");
  const currentScript = video.hindi_script === "roman" ? "roman" : "devanagari";

  const languageChanged =
    captionLanguage !== video.caption_language || (offerScript && hindiScript !== currentScript);
  // Captions made in a language no longer offered (v1.0.11) are kept, but a
  // Redo needs one that is.
  const captionOffered = languageOptions?.caption.some((option) => option.code === captionLanguage) ?? true;

  /**
   * The caption just added, so it can be focused once the refetch brings it in.
   *
   * The row does not exist yet when the mutation resolves — the list is
   * refetched, and only then is there a textarea to put a cursor in. Holding
   * the id and focusing on arrival is what makes "add a caption" leave you
   * typing in it rather than hunting for where it went.
   */
  const [pendingFocusId, setPendingFocusId] = useState<number | null>(null);

  // Keyboard navigation needs to move focus between rows, which React state
  // can't express — hold the actual DOM nodes.
  const inputs = useRef<(HTMLTextAreaElement | null)[]>([]);
  // The row wrappers, separately: scrolling measures the whole row, and the
  // textarea's offset would be off by its padding and timecode column.
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const list = useRef<HTMLDivElement>(null);

  const focusRow = useCallback((index: number) => {
    const element = inputs.current[index];
    if (!element) return;
    element.focus();
    // Caret to the end, so typing continues rather than overwriting.
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  // Warn before leaving with an unsaved edit still in its debounce window.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (updateCaption.isPending) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [updateCaption.isPending]);

  const captions = useMemo(() => data?.items ?? [], [data]);
  const { activeCaptionId } = playback;

  /**
   * Add a caption where the playhead is.
   *
   * The playhead is the answer to "when should this line appear" that the user
   * has already given by scrubbing there, so it needs no dialog. Clamped
   * inside the video's duration, because a caption starting past the end of
   * the file is one that can never be seen or played back to check.
   */
  function addCaption() {
    const duration = video.duration_ms ?? Number.MAX_SAFE_INTEGER;
    const start = Math.max(0, Math.min(Math.round(playback.currentMs()), duration - 1));
    const end = Math.min(start + NEW_CAPTION_MS, duration);

    createCaption.mutate(
      // Not an empty string: the caption has to be visible in the list and on
      // the video to be worth adding, and the API requires words.
      { start_ms: start, end_ms: end, text: "New caption" },
      { onSuccess: (created) => setPendingFocusId(created.id) }
    );
  }

  /**
   * Re-transcribe, then get out of the way.
   *
   * Transcription is minutes of GPU work that replaces every caption on this
   * screen, so there is nothing useful to do here while it runs — staying put
   * means watching a list you are about to lose. The dashboard shows the job
   * with a progress bar and the rest of the library beside it, which is the
   * screen someone actually wants for the next few minutes.
   *
   * `askToNotify` is called first and *not* awaited: a browser only honours a
   * permission request while the click that caused it is still the reason the
   * code is running, and waiting for someone to read the dialog before sending
   * the request would make the button feel stuck.
   */
  function redo() {
    askToNotify();

    retranscribe.mutate(
      {
        id: video.id,
        // Always auto: the spoken language is detected, and sending it
        // explicitly clears any hint a video picked up from the older UI.
        spoken_language: "auto",
        caption_language: captionLanguage,
        ...(offerScript ? { hindi_script: hindiScript } : {}),
      },
      {
        onSuccess: () => {
          // Only after the server has accepted it. Watching a job that was
          // rejected would poll a video that is not going anywhere, and the
          // error belongs on this screen where the button is.
          watchTranscription(video.id);
          router.push("/dashboard");
        },
      }
    );
  }

  // Focus and select the new caption once the refetched list contains it, so
  // the placeholder text is replaced by typing rather than edited around.
  useEffect(() => {
    if (pendingFocusId === null) return;
    const index = captions.findIndex((caption) => caption.id === pendingFocusId);
    if (index === -1) return;

    const element = inputs.current[index];
    if (!element) return;
    element.focus();
    element.select();
    setPendingFocusId(null);
  }, [pendingFocusId, captions]);

  /**
   * Keep the caption under the playhead in view.
   *
   * Two guards, both learned the hard way from editors that get this wrong:
   * scrolling the container directly instead of calling scrollIntoView, which
   * would drag the whole page along with it; and standing down entirely while
   * the focus is inside this list, because yanking the view mid-sentence is
   * far worse than letting it fall behind.
   */
  useEffect(() => {
    if (activeCaptionId === null) return;

    const container = list.current;
    if (!container || container.contains(document.activeElement)) return;

    const index = captions.findIndex((caption) => caption.id === activeCaptionId);
    const row = rows.current[index];
    if (!row) return;

    container.scrollTo({
      top: row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2,
      behavior: "smooth",
    });
    // `captions` is deliberately not a dependency: this should fire when the
    // playhead crosses into a new caption, not on every keystroke that edits
    // one. It is only read to find the row, never to decide whether to scroll.
  }, [activeCaptionId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn&apos;t load captions: {(error as Error).message}
      </p>
    );
  }

  if (captions.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 text-[15px] font-semibold">No captions yet</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          {video.status === "completed"
            ? "Transcription found no speech in this video. Music under the voice is the usual reason — try again, or write the captions yourself."
            : "They'll appear here once transcription finishes."}
        </p>

        {/* The two ways out, offered exactly where the dead end is. Saying
            "found no speech" and then leaving the user with no control was the
            worst version of this screen. */}
        {video.status === "completed" && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <ToolButton
              onClick={redo}
              disabled={retranscribe.isPending}
              icon={RefreshCw}
              spinning={retranscribe.isPending}
            >
              Transcribe again
            </ToolButton>
            <ToolButton
              onClick={addCaption}
              disabled={createCaption.isPending}
              icon={Plus}
              spinning={createCaption.isPending}
            >
              Add a caption
            </ToolButton>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex shrink-0 items-center gap-0.5">
          <span className="label-caps">
            {captions.length} caption{captions.length === 1 ? "" : "s"}
          </span>
          <AccuracyInfo />
        </div>

        <div className="flex items-center gap-1.5">
          {updateCaption.isPending && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Saving…
            </span>
          )}
          <ToolButton
            onClick={redo}
            disabled={retranscribe.isPending || video.status === "processing" || !captionOffered}
            icon={RefreshCw}
            spinning={retranscribe.isPending}
            title="Transcribe this video again, replacing every caption"
          >
            Redo
          </ToolButton>
          <ToolButton
            onClick={addCaption}
            disabled={createCaption.isPending}
            icon={Plus}
            spinning={createCaption.isPending}
            title="Add a caption at the playhead"
          >
            Add
          </ToolButton>
        </div>
      </div>

      {/* Two questions, not one, and keeping them separate is what makes the
          feature honest. "What is being spoken" is a hint that makes Whisper
          far more accurate — on a sung Punjabi track, naming the language beat
          auto-detect by more than twice the coverage. "What should the
          captions say" is a translation, and a different operation entirely. */}
      {languageOptions && (
        <div className="mb-4">
          {/* Compact rows from sm up, so the list below keeps the room. */}
          <div className="group-inset sm:[&_.group-row]:min-h-9 sm:[&_.group-row]:py-1">
            <div className="group-row">
              <span className="shrink-0 text-sm" aria-hidden="true">
                Captions
              </span>
              {/* Every language is offered, as on the dashboard's language step:
                  translation runs locally, so none of them needs a key. */}
              <LanguagePicker
                label="Caption language"
                options={languageOptions.caption}
                value={captionLanguage}
                onChange={setCaptionLanguage}
                className="w-48"
              />
            </div>

            {offerScript && languageOptions.hindi_scripts.length > 0 && (
              <div className="group-row">
                <label htmlFor="redo-hindi-script" className="shrink-0 text-sm">
                  Hindi in
                </label>
                <Select
                  id="redo-hindi-script"
                  size="sm"
                  value={hindiScript}
                  onChange={(event) => setHindiScript(event.target.value)}
                  className="w-48"
                >
                  {languageOptions.hindi_scripts.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {!captionOffered ? (
            <p className="mt-1.5 px-4 text-xs text-muted-foreground">
              {languageName(captionLanguage, languageOptions)} captions are no longer offered. Choose a
              language to redo.
            </p>
          ) : (
            languageChanged && (
              <p className="mt-1.5 px-4 text-xs text-muted-foreground">
                Press Redo to apply — it re-transcribes and replaces every caption.
              </p>
            )
          )}
        </div>
      )}

      {retranscribe.isError && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {(retranscribe.error as Error).message}
        </p>
      )}
      {createCaption.isError && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {(createCaption.error as Error).message}
        </p>
      )}

      {/* A Redo is running: the list still holds the old captions, while the
          picker above already names the new language. */}
      {(video.status === "pending" || video.status === "processing") && (
        <p role="status" className="mb-2 flex items-center gap-1.5 px-1 text-[13px] text-muted-foreground">
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          Showing the previous captions until the new ones are ready.
        </p>
      )}

      {/* `relative` so each row's offsetTop is measured against this box, which
          is what the auto-scroll above assumes. Rows are split by hairlines. */}
      <div
        ref={list}
        className="relative min-h-0 flex-1 divide-y divide-border overflow-y-auto"
      >
        {captions.map((caption, index) => (
          <CaptionRow
            key={caption.id}
            caption={caption}
            isLast={index === captions.length - 1}
            isActive={caption.id === activeCaptionId}
            registerRef={(element) => {
              inputs.current[index] = element;
            }}
            registerRow={(element) => {
              rows.current[index] = element;
            }}
            onSave={(text) => updateCaption.mutate({ id: caption.id, text })}
            onSeek={() => playback.seekMs(caption.start_ms)}
            onToggleEmphasis={() =>
              updateCaption.mutate({
                id: caption.id,
                ...(caption.override_bold === null ? EMPHASIS : NO_EMPHASIS),
              })
            }
            onSplit={() =>
              splitCaption.mutate({
                id: caption.id,
                // Split where the playhead is if it's inside this caption —
                // you have just watched the exact moment the line should
                // break. Otherwise fall back to the midpoint.
                atMs: splitPoint(caption, playback.currentMs()),
              })
            }
            onMerge={() => mergeCaption.mutate(caption.id)}
            onDelete={() => deleteCaption.mutate(caption.id)}
            onFocusNext={() => focusRow(Math.min(index + 1, captions.length - 1))}
            onFocusPrevious={() => focusRow(Math.max(index - 1, 0))}
          />
        ))}
      </div>

      <p className="mt-3 shrink-0 text-xs text-muted-foreground">
        Enter saves and moves on · Shift+Enter for a line break · Esc discards ·
        Space plays
      </p>
    </div>
  );
}

/** Where to cut: the playhead when it's inside the caption, else the middle. */
function splitPoint(caption: { start_ms: number; end_ms: number }, playheadMs: number) {
  const inside =
    playheadMs > caption.start_ms + 50 && playheadMs < caption.end_ms - 50;
  return Math.round(inside ? playheadMs : (caption.start_ms + caption.end_ms) / 2);
}

/**
 * A small labelled action, shared by the header and the empty state.
 *
 * Text beside the icon rather than an icon alone: these are the two controls
 * someone reaches for when the transcript is wrong or missing, which is
 * exactly the moment to not make them guess what a glyph means.
 */
function ToolButton({
  onClick,
  disabled,
  icon: Icon,
  spinning,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: typeof Plus;
  spinning?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm text-primary transition-colors duration-200 ease-out hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-8"
    >
      {spinning ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
      {children}
    </button>
  );
}
