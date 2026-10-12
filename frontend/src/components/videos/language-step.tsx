"use client";

import { ArrowLeft, ArrowRight, AudioLines, Check, Cpu, FileVideo, Loader2, Sparkles, Subtitles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatFileSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SystemInfo } from "@/types/system";
import type { LanguageOptions } from "@/types/video";

/** Each language in its own name, as the cards lead with it. */
const NATIVE_NAMES: Record<string, string> = {
  en: "English",
  hi: "हिन्दी",
  fr: "Français",
  de: "Deutsch",
  nl: "Nederlands",
};

/**
 * Step 2 of Upload → Language → Export, after a file is picked and before it
 * is sent: the caption language travels with the upload.
 *
 * The spoken language is shown, not asked: an upload is always transcribed
 * with detection, and the editor is where a wrong guess gets corrected.
 */
export function LanguageStep({
  file,
  language,
  onLanguage,
  options,
  system,
  upload,
  onBack,
  onStart,
  onCancel,
}: {
  file: File;
  language: string;
  onLanguage: (code: string) => void;
  options: LanguageOptions | undefined;
  system: SystemInfo | undefined;
  upload: { percent: number } | null;
  onBack: () => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const choices = options?.caption ?? [{ code: "same", label: "Same as spoken" }];
  const translating = language !== "same";
  const viaGemini = translating && system?.translation_engine === "gemini";
  const model = system?.whisper?.model;

  return (
    <div className="mx-auto flex w-full max-w-[880px] animate-fade-in flex-col gap-4">
      <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-1.5">
          <AudioLines className="size-[18px] text-primary" aria-hidden="true" />
          <h3 className="text-lg font-semibold tracking-tight">Spoken audio</h3>
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Sparkles className="size-[18px]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Auto-detect</p>
            <p className="text-xs text-muted-foreground">
              The language is detected from the audio. If it guesses wrong, set it in the editor and
              transcribe again.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-1.5">
          <Subtitles className="size-[18px] text-primary" aria-hidden="true" />
          <h3 className="text-lg font-semibold tracking-tight" id="caption-language-heading">
            Caption into
          </h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          The language the captions come out in.
        </p>

        <div
          role="radiogroup"
          aria-labelledby="caption-language-heading"
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {choices.map((option) => {
            const selected = option.code === language;
            const native = option.code === "same" ? "Same as spoken" : (NATIVE_NAMES[option.code] ?? option.label);
            const sub = option.code === "same" ? "No translation" : option.label;
            return (
              <label
                key={option.code}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-4 transition-colors",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
                  selected
                    ? "border-primary/60 bg-primary/10"
                    : "border-border bg-surface-2 hover:bg-surface-3",
                  (!options || upload) && "pointer-events-none opacity-60"
                )}
              >
                <input
                  type="radio"
                  name="caption_language"
                  value={option.code}
                  checked={selected}
                  onChange={() => onLanguage(option.code)}
                  disabled={!options || !!upload}
                  className="sr-only"
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate font-semibold leading-tight",
                      option.code === "same" ? "text-xl" : "text-2xl sm:text-[28px]"
                    )}
                    lang={option.code === "same" ? undefined : option.code}
                  >
                    {native}
                  </span>
                  <span
                    className={cn(
                      "mt-1 block text-[13px] font-medium",
                      selected ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {sub}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full",
                    selected ? "bg-primary text-primary-foreground" : "border border-border bg-card"
                  )}
                >
                  {selected && <Check className="size-4" />}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <p className="flex items-center gap-2 text-[13px]">
          <Cpu className="size-[18px] text-primary" aria-hidden="true" />
          <span>
            Speech engine: <strong className="font-semibold">faster-whisper</strong>
            {model && (
              <>
                {" "}· Model: <strong className="font-semibold">{model}</strong>
              </>
            )}
          </span>
        </p>
        <span
          className={cn(
            "flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider",
            viaGemini ? "text-warning" : "text-success"
          )}
        >
          <span className="size-2 rounded-full bg-current" aria-hidden="true" />
          {viaGemini ? "Translated with Gemini" : "Local & offline"}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <p className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
          <FileVideo className="size-[18px] shrink-0" aria-hidden="true" />
          <span className="truncate" title={file.name}>
            {file.name}
          </span>
          <span className="shrink-0 font-mono tabular-nums">· {formatFileSize(file.size)}</span>
        </p>

        {!upload ? (
          <div className="flex w-full items-center gap-3 sm:w-auto">
            <Button variant="secondary" onClick={onBack} aria-label="Choose a different video">
              <ArrowLeft />
              Back
            </Button>
            <Button onClick={onStart} className="flex-1 sm:flex-none">
              Start generating captions
              <ArrowRight />
            </Button>
          </div>
        ) : (
          <div className="w-full">
            <div className="flex items-center justify-between text-body-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                {upload.percent >= 100 && <Loader2 className="size-3.5 animate-spin" />}
                {/* The bar hits 100% when the bytes are sent, but the server
                    is still probing the file and making a thumbnail. */}
                {upload.percent < 100 ? "Uploading…" : "Preparing…"}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono tabular-nums">{upload.percent}%</span>
                <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label="Cancel upload">
                  <X />
                </Button>
              </span>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-label="Upload progress"
              aria-valuenow={upload.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-200 ease-out"
                style={{ width: `${upload.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
