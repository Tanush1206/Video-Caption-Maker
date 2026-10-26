"use client";

import { AudioLines, Check, FileVideo, Loader2, Search, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { LanguagePicker, matchesLanguage } from "@/components/videos/language-picker";
import { formatFileSize } from "@/lib/format";
import type { ScriptChoice, ScriptQuestion } from "@/lib/hindi-script";
import { languageName, TRY_ANYWAY, unsupportedSpeech } from "@/lib/languages";
import { cn } from "@/lib/utils";
import type { SystemInfo } from "@/types/system";
import type { LanguageOptions } from "@/types/video";

/**
 * Step 2 of Upload → Language → Export, while the picked file uploads.
 *
 * The spoken language is heard, not asked: the server listens to the first
 * 30 s of the upload. When that is Hindi the step asks how the captions are
 * written (`lib/hindi-script.ts` decides when, and what is preset). When it
 * is a language not offered (v1.0.11), the step says so and waits for the
 * spoken language to be chosen, or for "Try anyway"; anything else wrong is
 * corrected in the editor with a Redo.
 */
export function LanguageStep({
  file,
  language,
  onLanguage,
  options,
  system,
  upload,
  detection,
  question,
  script,
  onScript,
  unsupported,
  spoken,
  onSpoken,
  waitingToStart,
  starting,
  onBack,
  onStart,
  onCancel,
}: {
  file: File;
  language: string;
  onLanguage: (code: string) => void;
  options: LanguageOptions | undefined;
  system: SystemInfo | undefined;
  /** The upload while it is still sending; null once it has landed. */
  upload: { percent: number } | null;
  detection: { detected: string | null; confidence: number | null; listening: boolean };
  question: ScriptQuestion;
  script: ScriptChoice | null;
  onScript: (choice: ScriptChoice) => void;
  /** What was heard isn't offered: Start waits for `spoken`. */
  unsupported: boolean;
  /** A spoken language chosen instead of what was heard, or TRY_ANYWAY. */
  spoken: string | null;
  onSpoken: (choice: string) => void;
  /** Start was pressed and goes when the upload lands. */
  waitingToStart: boolean;
  starting: boolean;
  onBack: () => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const choices = options?.caption ?? [{ code: "same", label: "Same as spoken", native: null }];
  // Ten cards don't fit on a small screen, so they can be searched: by the
  // language's own name, its English name or its code. "Same as spoken" is
  // the default and is always shown.
  const [query, setQuery] = useState("");
  const visible = choices.filter((option) => option.code === "same" || matchesLanguage(option, query));
  const translating = language !== "same";
  const viaGemini = translating && system?.translation_engine === "gemini";
  const model = system?.whisper?.model;
  const busy = starting || waitingToStart;
  const heard = detection.detected ? languageName(detection.detected, options) : null;
  const needsSpoken = unsupported && spoken === null;
  const needsScript = question.show && question.required && script === null;
  const chosenSpoken = unsupported && spoken !== null && spoken !== TRY_ANYWAY ? spoken : null;
  const spokenOptions = (options?.spoken ?? []).filter((option) => option.code !== "auto");
  const scriptLabel = (code: ScriptChoice) => {
    const option = options?.hindi_scripts.find((o) => o.code === code);
    return { label: option?.label ?? code, download: option?.download_bytes ?? null };
  };

  return (
    <div className="mx-auto flex w-full max-w-[880px] animate-fade-in flex-col gap-12">
      <section aria-labelledby="spoken-audio-heading">
        <h3 className="text-xl font-semibold" id="spoken-audio-heading">
          Spoken audio
        </h3>
        <div className="group-inset mt-3 flex items-center gap-3 px-4 py-3" role="status" aria-live="polite">
          {detection.listening || (!heard && upload) ? (
            <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <AudioLines className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="text-[15px] font-medium">
              {heard
                ? `${heard} · heard at ${Math.round((detection.confidence ?? 0) * 100)}%`
                : upload
                  ? "Uploading, then listening…"
                  : detection.listening
                    ? "Listening to the first 30 seconds…"
                    : "Auto-detect"}
            </p>
            <p className="text-[13px] text-muted-foreground">
              {heard
                ? unsupported
                  ? "Detected from the audio."
                  : "Detected from the audio. If it's wrong, set it in the editor and transcribe again."
                : detection.listening || upload
                  ? "You can choose the caption language meanwhile."
                  : "The language is detected when transcribing starts."}
            </p>
          </div>
        </div>

        {unsupported && heard && (
          <Notice tone="warning" title={unsupportedSpeech(heard, false)} className="mt-3">
            <p id="unsupported-speech-hint">Choose the language that is spoken, or try anyway, to start.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <LanguagePicker
                label="Spoken language"
                options={spokenOptions}
                value={chosenSpoken ?? ""}
                onChange={onSpoken}
                disabled={busy}
                className="w-56"
              />
              <span className="flex items-center gap-3">
                <span>or</span>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-pressed={spoken === TRY_ANYWAY}
                  onClick={() => onSpoken(TRY_ANYWAY)}
                  disabled={busy}
                  className={cn(spoken === TRY_ANYWAY && "ring-2 ring-inset ring-accent")}
                >
                  {spoken === TRY_ANYWAY && <Check />}
                  Try anyway (low quality)
                </Button>
              </span>
            </div>
          </Notice>
        )}

        {question.show && (
          <fieldset className="mt-6">
            <legend className="px-4 text-[15px] font-semibold" id="hindi-script-heading">
              {question.heading}
            </legend>
            {question.required && (
              <p className="mt-0.5 px-4 text-[13px] text-muted-foreground" id="hindi-script-hint">
                {chosenSpoken
                  ? "Choose how to write Hindi to start."
                  : "Hindi was heard, but not surely. Choose how to write it to start."}
              </p>
            )}
            {/* A grouped list with a check on the chosen row (System Settings). */}
            <div role="radiogroup" aria-labelledby="hindi-script-heading" className="group-inset mt-2">
              {question.options.map((code) => {
                const selected = script === code;
                const { label, download } = scriptLabel(code);
                return (
                  <label
                    key={code}
                    className={cn(
                      "group-row cursor-pointer transition-colors duration-200 ease-out hover:bg-surface-3/50",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring",
                      busy && "pointer-events-none opacity-60"
                    )}
                  >
                    <input
                      type="radio"
                      name="hindi_script"
                      value={code}
                      checked={selected}
                      onChange={() => onScript(code)}
                      disabled={busy}
                      className="sr-only"
                    />
                    <span className="min-w-0">
                      <span className="block text-[15px]" lang={code === "roman" ? "hi-Latn" : "hi"}>
                        {label}
                      </span>
                      <span className="block text-[13px] text-muted-foreground">
                        {code === "roman"
                          ? download
                            ? `Downloads ${formatFileSize(download)} the first time`
                            : "Hindi in English letters"
                          : "Hindi in its own script"}
                      </span>
                    </span>
                    <Check
                      aria-hidden="true"
                      className={cn("size-5 shrink-0 text-primary", !selected && "invisible")}
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
      </section>

      <section aria-labelledby="caption-language-heading">
        <h3 className="text-xl font-semibold" id="caption-language-heading">
          Caption into
        </h3>
        <p className="mt-1 text-[15px] text-muted-foreground">The language the captions come out in.</p>

        <div className="relative mt-4">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search caption languages"
            placeholder={`Search ${choices.length - 1} languages — हिन्दी, Español, German…`}
            disabled={!options || busy}
            className={cn(inputClasses, "pl-9")}
          />
        </div>

        <div
          role="radiogroup"
          aria-labelledby="caption-language-heading"
          className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
        >
          {visible.map((option) => {
            const selected = option.code === language;
            const native = option.code === "same" ? "Same as spoken" : (option.native ?? option.label);
            const sub = option.code === "same" ? "No translation" : option.label;
            return (
              <label
                key={option.code}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-card px-4 py-3.5",
                  "transition-[background-color,box-shadow] duration-200 ease-out",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
                  // The chosen one is outlined in the accent: the selected state.
                  selected ? "ring-2 ring-inset ring-accent" : "hover:bg-surface-3/60",
                  (!options || busy) && "pointer-events-none opacity-60"
                )}
              >
                <input
                  type="radio"
                  name="caption_language"
                  value={option.code}
                  checked={selected}
                  onChange={() => onLanguage(option.code)}
                  disabled={!options || busy}
                  className="sr-only"
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate font-semibold",
                      option.code === "same" ? "text-[17px] leading-[25px]" : "text-xl"
                    )}
                    lang={option.code === "same" ? undefined : option.code}
                  >
                    {native}
                  </span>
                  <span className="block text-[13px] text-muted-foreground">{sub}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full",
                    selected ? "bg-accent text-white" : "border border-input"
                  )}
                >
                  {selected && <Check className="size-3.5" strokeWidth={2.5} />}
                </span>
              </label>
            );
          })}
        </div>
        {visible.length === 1 && query.trim() && (
          <p role="status" className="mt-3 text-[13px] text-muted-foreground">
            No caption language matches “{query.trim()}”.
          </p>
        )}
      </section>

      {/* The file, how it will run, and the step's one action. */}
      <div className="flex flex-col gap-4 border-t border-border pt-5">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[13px] text-muted-foreground">
          <p className="flex min-w-0 items-center gap-2">
            <FileVideo className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate" title={file.name}>
              {file.name}
            </span>
            <span className="shrink-0 tabular-nums">· {formatFileSize(file.size)}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("size-2 shrink-0 rounded-full", viaGemini ? "bg-warning" : "bg-success")}
            />
            {viaGemini ? "Translated with Gemini" : "Local and offline"}
            {" · "}faster-whisper{model && ` ${model}`}
          </p>
        </div>

        {upload && (
          <div>
            <div className="flex items-center justify-between text-[13px] text-muted-foreground">
              <span className="flex items-center gap-2">
                {upload.percent >= 100 && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                {/* The bar hits 100% when the bytes are sent, but the server
                    is still probing the file and making a thumbnail. */}
                {upload.percent < 100 ? "Uploading…" : "Preparing…"}
              </span>
              <span className="flex items-center gap-1">
                <span className="tabular-nums">{upload.percent}%</span>
                <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label="Cancel upload">
                  <X />
                </Button>
              </span>
            </div>
            <div
              className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-label="Upload progress"
              aria-valuenow={upload.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="bar-fill h-full rounded-full transition-all duration-200 ease-out"
                style={{ width: `${upload.percent}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
          <div className="flex w-full items-center gap-3 sm:w-auto">
            <Button
              variant="secondary"
              onClick={onBack}
              disabled={starting}
              aria-label="Choose a different video"
            >
              Back
            </Button>
            <Button
              onClick={onStart}
              disabled={busy || needsSpoken || needsScript}
              aria-describedby={
                needsSpoken ? "unsupported-speech-hint" : needsScript ? "hindi-script-hint" : undefined
              }
              className="flex-1 sm:flex-none"
            >
              {busy && <Loader2 className="animate-spin" />}
              {waitingToStart ? "Starting when uploaded…" : "Start generating captions"}
            </Button>
          </div>
          {needsSpoken ? (
            <p className="text-[13px] text-muted-foreground">Choose the spoken language, or try anyway, first.</p>
          ) : (
            needsScript && (
              <p className="text-[13px] text-muted-foreground">Choose how to write the captions first.</p>
            )
          )}
        </div>
      </div>
    </div>
  );
}
