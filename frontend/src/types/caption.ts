export interface Caption {
  id: number;
  sequence: number;
  start_ms: number;
  end_ms: number;
  text: string;
  /** Whisper's average log-probability; lower means less certain. */
  confidence: number | null;

  // Per-caption emphasis. null means "inherit the video's style", which is not
  // the same as holding the same value — an inheriting caption follows along
  // when the style changes.
  override_color: string | null;
  override_bold: boolean | null;
  override_scale: number | null;
}

export interface CaptionList {
  items: Caption[];
  total: number;
}

/** Both halves returned by a split, so the client needn't refetch to know them. */
export interface CaptionPair {
  first: Caption;
  second: Caption;
}

/** What a find or replace request sends (v1.3.0). */
export interface CaptionReplaceRequest {
  find: string;
  replace: string;
  match_case: boolean;
  whole_word: boolean;
  /** The captions to change; null for every match. */
  caption_ids?: number[] | null;
  /** False: only show what would change. */
  apply: boolean;
}

/** One caption the text was found in. */
export interface CaptionMatch {
  id: number;
  start_ms: number;
  end_ms: number;
  before: string;
  after: string;
  /** Where the matches are in `before`, as [start, end) character offsets. */
  spans: [number, number][];
  /** The replacement would leave it empty: never applied to this one. */
  empty: boolean;
  /** Changed by this request. */
  applied: boolean;
}

export interface CaptionReplaceResult {
  matches: CaptionMatch[];
  /** Occurrences, not captions: one caption can hold several. */
  occurrences: number;
}

/** Words of a caption, and whether a fix changed them (v1.3.0). */
export interface WordRun {
  text: string;
  changed: boolean;
}

/** One caption a Gemini check changed. */
export interface CaptionFix {
  id: number;
  caption_id: number;
  start_ms: number;
  end_ms: number;
  before: string;
  after: string;
  before_words: WordRun[];
  after_words: WordRun[];
  undone: boolean;
  /** Edited by hand since the fix: Undo would lose the edit, so it isn't offered. */
  edited: boolean;
}

export type CaptionCheckStatus = "queued" | "running" | "completed" | "failed";

/** The latest "Improve captions with Gemini" run on a video. */
export interface CaptionCheck {
  id: number;
  status: CaptionCheckStatus;
  batches_total: number;
  batches_done: number;
  /** The server's estimate while queued or running; null once finished. */
  seconds_left: number | null;
  /** Fixes Gemini offered that the safety checks left out. */
  dropped: number;
  /** Requests Gemini Flash failed (busy, timed out) and Gemini Flash-Lite answered. */
  fallback_batches: number;
  error_message: string | null;
  fixes: CaptionFix[];
}
