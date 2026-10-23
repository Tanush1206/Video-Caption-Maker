/**
 * Naming languages, and which spoken ones are offered (v1.0.11).
 *
 * The server serves the languages offered. Speech can be heard in any of the
 * ninety-nine Whisper knows, and a video can hold captions in one no longer
 * offered (Tamil, Marathi, Bengali and Malayalam, until v1.0.10), so a code
 * the server doesn't list is named by the browser instead.
 */

import type { LanguageOptions } from "@/types/video";

/** "Try anyway" on the language step: transcribe what was heard though it isn't offered. */
export const TRY_ANYWAY = "anyway";

/** The language's English name: as served, or the browser's name for it, or the code. */
export function languageName(code: string, options: LanguageOptions | undefined): string {
  const served = [...(options?.spoken ?? []), ...(options?.caption ?? [])].find((o) => o.code === code);
  if (served) return served.label;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Whether speech in `code` is offered, so captions from it can be trusted. */
export function isOfferedSpeech(code: string, options: LanguageOptions): boolean {
  return code !== "auto" && options.spoken.some((option) => option.code === code);
}

/** What the language step and the editor say about speech that isn't offered. */
export function unsupportedSpeech(name: string, made: boolean): string {
  return made
    ? `${name} speech isn't supported yet, so these captions are likely inaccurate.`
    : `${name} speech isn't supported yet, so captions would be inaccurate.`;
}
