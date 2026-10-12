"use client";

import { CornerRightDown, Highlighter, PlayCircle, Scissors, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { formatTimecode } from "@/lib/format";
import type { Caption } from "@/types/caption";

/** Whisper's avg_logprob; below this the line is usually worth checking. */
const LOW_CONFIDENCE = -1.0;

const AUTOSAVE_DELAY_MS = 800;

interface CaptionRowProps {
  caption: Caption;
  isLast: boolean;
  /** True while the playhead is inside this caption's time range. */
  isActive: boolean;
  onSave: (text: string) => void;
  onSplit: () => void;
  onMerge: () => void;
  onDelete: () => void;
  onSeek: () => void;
  onToggleEmphasis: () => void;
  onFocusNext: () => void;
  onFocusPrevious: () => void;
  registerRef: (element: HTMLTextAreaElement | null) => void;
  registerRow: (element: HTMLDivElement | null) => void;
}

export function CaptionRow({
  caption,
  isLast,
  isActive,
  onSave,
  onSplit,
  onMerge,
  onDelete,
  onSeek,
  onToggleEmphasis,
  onFocusNext,
  onFocusPrevious,
  registerRef,
  registerRow,
}: CaptionRowProps) {
  const [text, setText] = useState(caption.text);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Accept server changes (a re-transcribe, or another tab) unless the user
  // is mid-edit — clobbering someone's unsaved typing is worse than being
  // briefly stale.
  useEffect(() => {
    if (!dirty) setText(caption.text);
  }, [caption.text, dirty]);

  // Debounced autosave. Saving on every keystroke would be a request per
  // character; saving only on blur loses work if the tab closes.
  useEffect(() => {
    if (!dirty) return;

    timer.current = setTimeout(() => {
      onSave(text);
      setDirty(false);
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text, dirty, onSave]);

  const flush = () => {
    if (!dirty) return;
    if (timer.current) clearTimeout(timer.current);
    onSave(text);
    setDirty(false);
  };

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter saves and moves on; Shift+Enter inserts a newline, as in any
    // editor. Without this, Enter would just add invisible whitespace to a
    // subtitle line.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      flush();
      onFocusNext();
      return;
    }
    if (event.key === "ArrowDown" && event.metaKey) {
      event.preventDefault();
      onFocusNext();
    }
    if (event.key === "ArrowUp" && event.metaKey) {
      event.preventDefault();
      onFocusPrevious();
    }
    if (event.key === "Escape") {
      setText(caption.text);
      setDirty(false);
    }
  }

  const lowConfidence =
    caption.confidence !== null && caption.confidence < LOW_CONFIDENCE;

  // Any override at all counts. The three are set and cleared together by the
  // toggle, but a caption edited through the API might carry only one.
  const emphasised =
    caption.override_color !== null ||
    caption.override_bold !== null ||
    caption.override_scale !== null;

  return (
    // A card per caption rather than a table row. Each one is an editable
    // object with its own timing, text and actions, and flush rows made a
    // wrapped two-line caption hard to tell from the next caption entirely.
    <div
      ref={registerRow}
      className={cn(
        "group rounded-lg border p-3 transition-colors",
        isActive
          ? "border-primary/60 bg-primary/10"
          : lowConfidence
            ? "border-warning/40 bg-surface-1 hover:bg-surface-2"
            : "border-border bg-surface-1 hover:border-input hover:bg-surface-2"
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSeek}
          title="Jump the video here"
          className={cn(
            "flex items-center gap-2 font-mono text-xs tabular-nums transition-colors hover:text-primary",
            isActive ? "font-semibold text-primary" : "text-muted-foreground"
          )}
        >
          <PlayCircle className={cn("size-4", isActive && "fill-primary/20")} />
          {formatTimecode(caption.start_ms)}
          <span aria-hidden="true">→</span>
          <span className="sr-only">to</span>
          {formatTimecode(caption.end_ms)}
        </button>

        {lowConfidence && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning group-hover:hidden">
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            Check this line
          </span>
        )}

        {/* Always visible on the active row: it is the one you are editing, so
            its actions should not require a hover to find. */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100",
            isActive ? "opacity-100" : "opacity-0"
          )}
        >
        <button
          type="button"
          onClick={onToggleEmphasis}
          aria-pressed={emphasised}
          title={emphasised ? "Remove emphasis" : "Emphasise this caption"}
          aria-label="Toggle emphasis"
          className={cn(
            "rounded p-1.5 transition hover:bg-muted",
            emphasised
              ? "text-warning"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Highlighter className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onSplit}
          title="Split at midpoint"
          aria-label="Split caption"
          className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <Scissors className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onMerge}
          disabled={isLast}
          title={isLast ? "No caption after this one" : "Merge with next"}
          aria-label="Merge with next caption"
          className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <CornerRightDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete caption"
          aria-label="Delete caption"
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        </div>
      </div>

      <textarea
        ref={registerRef}
        value={text}
        rows={Math.max(1, Math.ceil(text.length / 48))}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        onBlur={flush}
        onKeyDown={handleKeyDown}
        className={cn(
          // Reads as text, not a form field, until it is touched: DESIGN.md's
          // "transparent background and seamless borders".
          "-mx-1.5 w-[calc(100%+0.75rem)] resize-none rounded-md border bg-transparent px-1.5 py-1 text-[15px] leading-relaxed transition-colors",
          "hover:border-border focus:border-ring focus:bg-background/40 focus:outline-none",
          dirty ? "border-primary/50" : "border-transparent"
        )}
        aria-label={`Caption at ${formatTimecode(caption.start_ms)}`}
      />

      {lowConfidence && <span className="sr-only">Low confidence: worth checking.</span>}
    </div>
  );
}
