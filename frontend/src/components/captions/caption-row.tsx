"use client";

import { Scissors, Trash2, CornerRightDown } from "lucide-react";
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

  return (
    <div
      ref={registerRow}
      className={cn(
        "group flex gap-3 rounded-md border px-2 py-2 transition",
        isActive
          ? "border-primary/40 bg-primary/5"
          : "border-transparent hover:border-border hover:bg-muted/40"
      )}
    >
      <button
        type="button"
        onClick={onSeek}
        title="Jump the video here"
        className="w-24 shrink-0 pt-2 text-right transition hover:text-primary"
      >
        <span className="block font-mono text-xs tabular-nums text-muted-foreground">
          {formatTimecode(caption.start_ms)}
        </span>
        <span className="block font-mono text-[10px] tabular-nums text-muted-foreground/60">
          {formatTimecode(caption.end_ms)}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <textarea
          ref={registerRef}
          value={text}
          rows={Math.max(1, Math.ceil(text.length / 60))}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          onBlur={flush}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm leading-relaxed transition",
            "focus:outline-none focus:ring-2 focus:ring-primary/40",
            dirty ? "border-primary/50" : "border-transparent",
            lowConfidence && !dirty && "border-amber-500/40"
          )}
          aria-label={`Caption at ${formatTimecode(caption.start_ms)}`}
        />

        {lowConfidence && (
          <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-500">
            Low confidence — worth checking
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-start gap-1 pt-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
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
          className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
