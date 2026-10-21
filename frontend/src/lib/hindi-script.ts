/**
 * Whether, and how, the language step asks how Hindi is written (v1.0.9).
 *
 * The server serves the threshold and the options; this only decides what to
 * show for what was heard. Hindi heard at the threshold or above presets
 * Hinglish. Hindi below it, or Marathi (the two share a script and much of
 * their sound, and detection trades them), asks with nothing preset, and
 * Start waits for an answer. Detection that hasn't answered in time asks
 * too, but doesn't hold Start: the job then decides the same way ("auto").
 */

export type ScriptChoice = "roman" | "devanagari" | "mr";

export interface ScriptQuestion {
  show: boolean;
  heading: string;
  options: ScriptChoice[];
  preset: ScriptChoice | null;
  /** Start waits for a pick. */
  required: boolean;
}

const HIDDEN: ScriptQuestion = { show: false, heading: "", options: [], preset: null, required: false };

/** How long the step waits for detection before asking without a preset. */
export const DETECTION_WAIT_MS = 15_000;

export function scriptQuestion({
  detected,
  confidence,
  timedOut,
  captionLanguage,
  minConfidence,
}: {
  detected: string | null;
  confidence: number | null;
  timedOut: boolean;
  captionLanguage: string;
  minConfidence: number;
}): ScriptQuestion {
  // Only Hindi captions are written one way or the other. English comes from
  // the speech model's own translation, and the other languages from a
  // translation the job sources the same way it would decide here.
  if (captionLanguage !== "same" && captionLanguage !== "hi") return HIDDEN;

  if (detected === null) {
    if (!timedOut) return HIDDEN;
    return {
      show: true,
      heading: "If it's Hindi, write the captions in",
      options: ["roman", "devanagari"],
      preset: null,
      required: false,
    };
  }
  if (detected === "hi") {
    const sure = confidence !== null && confidence >= minConfidence;
    return {
      show: true,
      heading: "Hindi captions in",
      options: ["roman", "devanagari"],
      preset: sure ? "roman" : null,
      required: !sure,
    };
  }
  if (detected === "mr") {
    return {
      show: true,
      heading: "Hindi or Marathi? Write the captions in",
      options: ["roman", "devanagari", "mr"],
      preset: null,
      required: true,
    };
  }
  return HIDDEN;
}

/** What Start sends for a choice (or none). */
export function startRequest(
  choice: ScriptChoice | null,
  captionLanguage: string
): { spoken_language: string; caption_language: string; hindi_script?: string } {
  if (choice === "roman" || choice === "devanagari") {
    return { spoken_language: "hi", caption_language: captionLanguage, hindi_script: choice };
  }
  if (choice === "mr") return { spoken_language: "mr", caption_language: captionLanguage };
  // Not asked, or not answered: detect again and decide by the same rule.
  return { spoken_language: "auto", caption_language: captionLanguage, hindi_script: "auto" };
}
